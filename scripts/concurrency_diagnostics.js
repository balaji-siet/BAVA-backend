const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:5000';
const agent = new http.Agent({ keepAlive: true, maxSockets: 2000 });

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

async function runIsolatedTest(testName, count, fn) {
  console.log(`\n--- Running ${testName} (${count} Concurrent Requests) ---`);
  const memBefore = process.memoryUsage();
  const startTime = Date.now();

  const promises = Array.from({ length: count }, (_, i) => fn(i));
  const results = await Promise.all(promises);

  const durationMs = Date.now() - startTime;
  const memAfter = process.memoryUsage();

  const latencies = results.map(r => r.duration);
  const success2xx = results.filter(r => r.status >= 200 && r.status < 300).length;
  const timeouts = results.filter(r => r.error === 'TIMEOUT').length;
  const failures = results.length - success2xx;

  const summary = {
    testName,
    concurrency: count,
    totalRequests: count,
    success2xx,
    failures,
    timeouts,
    durationMs,
    throughputRps: parseFloat((count / (durationMs / 1000)).toFixed(2)),
    latency: {
      averageMs: Math.round(latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1)),
      p50Ms: calculatePercentile(latencies, 50),
      p95Ms: calculatePercentile(latencies, 95),
      p99Ms: calculatePercentile(latencies, 99),
      maxMs: Math.max(...latencies, 0)
    },
    memoryMb: {
      heapUsed: Math.round(memAfter.heapUsed / 1024 / 1024),
      rss: Math.round(memAfter.rss / 1024 / 1024)
    }
  };

  console.log(`  Success: ${success2xx}/${count} (${((success2xx/count)*100).toFixed(1)}%) | Timeouts: ${timeouts}`);
  console.log(`  Duration: ${(durationMs/1000).toFixed(2)}s | RPS: ${summary.throughputRps}`);
  console.log(`  P50: ${summary.latency.p50Ms}ms | P95: ${summary.latency.p95Ms}ms | Max: ${summary.latency.maxMs}ms`);

  return summary;
}

async function runDiagnosticsSuite() {
  console.log("============================================================");
  console.log("PHASE 2 — EMPIRICAL CONCURRENCY DIAGNOSTICS SUITE");
  console.log("============================================================");

  // Obtain JWT token for protected endpoints
  console.log("Logging in test user to obtain JWT token...");
  const authRes = await makeRequest('POST', '/api/student/login', {
    email: 'real_pre_1786355810000_0@test.local',
    password: 'TestUserPass123!'
  });
  let token = authRes.data && authRes.data.token;
  if (!token) {
    // Register temporary user
    const tempRoll = `DIAG_USER_${Date.now()}`;
    const tempEmail = `diag_${Date.now()}@test.local`;
    await makeRequest('POST', '/api/student/register', {
      name: 'Diag User',
      roll_number: tempRoll,
      department: 'CSE',
      email: tempEmail,
      password: 'TestUserPass123!'
    });
    const lRes = await makeRequest('POST', '/api/student/login', { email: tempEmail, password: 'TestUserPass123!' });
    token = lRes.data && lRes.data.token;
  }
  console.log("JWT Token acquired successfully.");

  const allDiagnostics = {};

  // TEST A: 100 concurrent read-only requests
  allDiagnostics.TEST_A_100_READ = await runIsolatedTest('TEST_A_100_READ', 100, () =>
    makeRequest('GET', '/api/menu/today', null, token)
  );

  // TEST B: 250 concurrent read-only requests
  allDiagnostics.TEST_B_250_READ = await runIsolatedTest('TEST_B_250_READ', 250, () =>
    makeRequest('GET', '/api/menu/today', null, token)
  );

  // TEST C: 500 concurrent read-only requests
  allDiagnostics.TEST_C_500_READ = await runIsolatedTest('TEST_C_500_READ', 500, () =>
    makeRequest('GET', '/api/menu/today', null, token)
  );

  // TEST D: 1,000 concurrent read-only requests
  allDiagnostics.TEST_D_1000_READ = await runIsolatedTest('TEST_D_1000_READ', 1000, () =>
    makeRequest('GET', '/api/menu/today', null, token)
  );

  // TEST E: 500 concurrent reservation/write requests
  allDiagnostics.TEST_E_500_WRITE = await runIsolatedTest('TEST_E_500_WRITE', 500, (i) =>
    makeRequest('POST', '/api/reservations/create', { date: '2026-08-15', meals: ['lunch'] }, token)
  );

  // TEST F: 1,000 concurrent reservation/write requests
  allDiagnostics.TEST_F_1000_WRITE = await runIsolatedTest('TEST_F_1000_WRITE', 1000, (i) =>
    makeRequest('POST', '/api/reservations/create', { date: '2026-08-15', meals: ['lunch'] }, token)
  );

  // TEST G: 500 concurrent login requests
  allDiagnostics.TEST_G_500_LOGIN = await runIsolatedTest('TEST_G_500_LOGIN', 500, (i) =>
    makeRequest('POST', '/api/student/login', { email: 'real_pre_1786355810000_0@test.local', password: 'TestUserPass123!' })
  );

  // TEST H: 1,000 concurrent login requests
  allDiagnostics.TEST_H_1000_LOGIN = await runIsolatedTest('TEST_H_1000_LOGIN', 1000, (i) =>
    makeRequest('POST', '/api/student/login', { email: 'real_pre_1786355810000_0@test.local', password: 'TestUserPass123!' })
  );

  console.log("\n============================================================");
  console.log("DIAGNOSTICS SUMMARY TABLE:");
  console.table(allDiagnostics);

  const reportPath = path.join(__dirname, 'concurrency_diagnostics_results.json');
  fs.writeFileSync(reportPath, JSON.stringify(allDiagnostics, null, 2));
  console.log(`Saved diagnostics summary to: ${reportPath}`);
}

runDiagnosticsSuite().catch(console.error);
