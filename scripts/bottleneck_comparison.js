const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:5000';
const agent = new http.Agent({ keepAlive: true, maxSockets: 1000 });

function makeRequest(method, pathStr, body = null, token = null) {
  return new Promise((resolve) => {
    const url = new URL(pathStr, BASE_URL);
    const options = {
      method: method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      agent: agent,
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 10000
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const startTime = Date.now();
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const duration = Date.now() - startTime;
        let parsed = null;
        try { parsed = JSON.parse(data); } catch (e) {}
        resolve({
          status: res.statusCode,
          duration: duration,
          error: null,
          data: parsed
        });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        status: 0,
        duration: Date.now() - startTime,
        error: 'TIMEOUT',
        data: null
      });
    });

    req.on('error', (err) => {
      resolve({
        status: 0,
        duration: Date.now() - startTime,
        error: err.code || err.message,
        data: null
      });
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

function calculatePercentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

async function runComparisonTests() {
  console.log("============================================================");
  console.log("PHASE 5 — BOTTLENECK ISOLATION & COMPARISON SUITE");
  console.log("============================================================");

  const testResults = {};

  // 1. Provision 100 pre-created users first (sequentially to avoid hashing burst)
  console.log("\nProvisioning 100 pre-created test users for Test B...");
  const preCreatedUsers = [];
  for (let i = 0; i < 100; i++) {
    const rollNumber = `PRE_USER_${i}_${Date.now()}`;
    const email = `pre_user_${i}_${Date.now()}@test.local`;
    const password = 'TestUserPass123!';
    const regRes = await makeRequest('POST', '/api/student/register', {
      name: `Pre User ${i}`,
      roll_number: rollNumber,
      department: 'CSE',
      email: email,
      password: password
    });
    if (regRes.status === 201) {
      preCreatedUsers.push({ email, password, rollNumber });
    }
  }
  console.log(`Provisioned ${preCreatedUsers.length} pre-created users.`);

  // TEST D: Read-Only API Benchmark (Menu retrieval with Bearer token)
  console.log("\n--- TEST D: Read-Only API Benchmark (100 Concurrent GET /api/menu/today) ---");
  // Login one user to get token
  const tokenRes = await makeRequest('POST', '/api/student/login', {
    email: preCreatedUsers[0].email,
    password: preCreatedUsers[0].password
  });
  const token = tokenRes.data && tokenRes.data.token;

  const startD = Date.now();
  const promisesD = Array.from({ length: 100 }, () => makeRequest('GET', '/api/menu/today', null, token));
  const resD = await Promise.all(promisesD);
  const durationD = Date.now() - startD;
  const latenciesD = resD.map(r => r.duration);
  const successD = resD.filter(r => r.status === 200).length;
  const timeoutD = resD.filter(r => r.error === 'TIMEOUT').length;

  testResults.TEST_D_READ_ONLY = {
    totalRequests: 100,
    success2xx: successD,
    timeouts: timeoutD,
    durationMs: durationD,
    rps: (100 / (durationD / 1000)).toFixed(2),
    avgMs: Math.round(latenciesD.reduce((a, b) => a + b, 0) / 100),
    p95Ms: calculatePercentile(latenciesD, 95),
    maxMs: Math.max(...latenciesD)
  };

  // TEST C: Registration-Only Benchmark (100 Concurrent POST /api/student/register)
  console.log("\n--- TEST C: Registration-Only Benchmark (100 Concurrent Registrations) ---");
  const startC = Date.now();
  const promisesC = Array.from({ length: 100 }, (_, i) => makeRequest('POST', '/api/student/register', {
    name: `Reg Test ${i}`,
    roll_number: `REG_ONLY_${i}_${Date.now()}`,
    department: 'ECE',
    email: `reg_only_${i}_${Date.now()}@test.local`,
    password: 'TestUserPass123!'
  }));
  const resC = await Promise.all(promisesC);
  const durationC = Date.now() - startC;
  const latenciesC = resC.map(r => r.duration);
  const successC = resC.filter(r => r.status === 201).length;
  const timeoutC = resC.filter(r => r.error === 'TIMEOUT').length;

  testResults.TEST_C_REGISTRATION_ONLY = {
    totalRequests: 100,
    success2xx: successC,
    timeouts: timeoutC,
    durationMs: durationC,
    rps: (100 / (durationC / 1000)).toFixed(2),
    avgMs: Math.round(latenciesC.reduce((a, b) => a + b, 0) / 100),
    p95Ms: calculatePercentile(latenciesC, 95),
    maxMs: Math.max(...latenciesC)
  };

  // TEST B: Pre-Created Users (Login -> Read -> Reserve -> Cancel without registration)
  console.log("\n--- TEST B: Pre-Created Users Workflow (100 Concurrent Existing Users) ---");
  const startB = Date.now();
  const promisesB = preCreatedUsers.map(async (u) => {
    const l = await makeRequest('POST', '/api/student/login', { email: u.email, password: u.password });
    const t = l.data && l.data.token;
    if (!t) return [l];
    const m = await makeRequest('GET', '/api/menu/today', null, t);
    const r = await makeRequest('POST', '/api/reservations/create', { date: new Date().toISOString().split('T')[0], meals: ['lunch'] }, t);
    const c = await makeRequest('POST', '/api/cancel-reservation', { date: new Date().toISOString().split('T')[0], mealType: 'lunch' }, t);
    return [l, m, r, c];
  });
  const resBFlat = (await Promise.all(promisesB)).flat();
  const durationB = Date.now() - startB;
  const latenciesB = resBFlat.map(r => r.duration);
  const successB = resBFlat.filter(r => r.status >= 200 && r.status < 300).length;
  const timeoutB = resBFlat.filter(r => r.error === 'TIMEOUT').length;

  testResults.TEST_B_PRE_CREATED_WORKFLOW = {
    totalRequests: resBFlat.length,
    success2xx: successB,
    timeouts: timeoutB,
    durationMs: durationB,
    rps: (resBFlat.length / (durationB / 1000)).toFixed(2),
    avgMs: Math.round(latenciesB.reduce((a, b) => a + b, 0) / (latenciesB.length || 1)),
    p95Ms: calculatePercentile(latenciesB, 95),
    maxMs: Math.max(...latenciesB, 0)
  };

  console.log("\n============================================================");
  console.log("BOTTLENECK ISOLATION RESULTS:");
  console.table(testResults);

  const reportPath = path.join(__dirname, 'bottleneck_comparison_results.json');
  fs.writeFileSync(reportPath, JSON.stringify(testResults, null, 2));
  console.log(`Saved comparison results to: ${reportPath}`);
}

runComparisonTests().catch(console.error);
