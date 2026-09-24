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

async function runVirtualUser(userIndex, runId) {
  const userResults = [];
  const rollNumber = `LOAD_${runId}_${userIndex}_${Date.now()}`;
  const email = `load_${runId}_${userIndex}_${Date.now()}@test.local`;
  const password = 'TestUserPass123!';

  // Step 1: Register
  const r1 = await makeRequest('POST', '/api/student/register', {
    name: `Load User ${userIndex}`,
    roll_number: rollNumber,
    department: 'CSE',
    email: email,
    password: password
  });
  userResults.push({ step: 'register', ...r1 });

  // Step 2: Login
  const r2 = await makeRequest('POST', '/api/student/login', {
    email: email,
    password: password
  });
  userResults.push({ step: 'login', ...r2 });

  const token = r2.data && r2.data.token;
  if (!token) {
    return userResults;
  }

  // Step 3: Menu Today
  const r3 = await makeRequest('GET', '/api/menu/today', null, token);
  userResults.push({ step: 'menu', ...r3 });

  // Step 4: Meal Settings
  const r4 = await makeRequest('GET', '/api/meal-settings/today', null, token);
  userResults.push({ step: 'meal_settings', ...r4 });

  // Step 5: Reservation Create
  const todayStr = new Date().toISOString().split('T')[0];
  const r5 = await makeRequest('POST', '/api/reservations/create', {
    date: todayStr,
    meals: ['lunch', 'dinner']
  }, token);
  userResults.push({ step: 'reserve', ...r5 });

  // Step 6: Reservation History
  const r6 = await makeRequest('GET', '/api/reservations/history', null, token);
  userResults.push({ step: 'history', ...r6 });

  // Step 7: Cancel Reservation
  const r7 = await makeRequest('POST', '/api/cancel-reservation', {
    date: todayStr,
    mealType: 'lunch'
  }, token);
  userResults.push({ step: 'cancel', ...r7 });

  return userResults;
}

function calculatePercentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

async function runStage(concurrencyLevel) {
  console.log(`\n============================================================`);
  console.log(`RUNNING CONCURRENT LOAD STAGE: ${concurrencyLevel} VIRTUAL USERS`);
  console.log(`============================================================`);

  const runId = Date.now();
  const startTime = Date.now();

  const userPromises = [];
  for (let i = 0; i < concurrencyLevel; i++) {
    userPromises.push(runVirtualUser(i, runId));
  }

  const allUserResults = await Promise.all(userPromises);
  const totalDurationMs = Date.now() - startTime;

  const flatResults = allUserResults.flat();
  const totalRequests = flatResults.length;
  const latencies = flatResults.map(r => r.duration);

  let successCount = 0;
  let failCount = 0;
  let count2xx = 0;
  let count4xx = 0;
  let count409 = 0;
  let count429 = 0;
  let count5xx = 0;
  let timeoutCount = 0;

  flatResults.forEach(r => {
    if (r.error === 'TIMEOUT') {
      timeoutCount++;
      failCount++;
    } else if (r.status >= 200 && r.status < 300) {
      count2xx++;
      successCount++;
    } else {
      failCount++;
      if (r.status === 409) count409++;
      else if (r.status === 429) count429++;
      else if (r.status >= 400 && r.status < 500) count4xx++;
      else if (r.status >= 500) count5xx++;
    }
  });

  const avgLatency = latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1);
  const medianLatency = calculatePercentile(latencies, 50);
  const p95Latency = calculatePercentile(latencies, 95);
  const p99Latency = calculatePercentile(latencies, 99);
  const maxLatency = Math.max(...latencies, 0);
  const rps = (totalRequests / (totalDurationMs / 1000)).toFixed(2);

  const stageSummary = {
    concurrencyLevel,
    totalRequests,
    successCount,
    failCount,
    count2xx,
    count4xx,
    count409,
    count429,
    count5xx,
    timeoutCount,
    totalDurationMs,
    requestsPerSecond: parseFloat(rps),
    latency: {
      averageMs: Math.round(avgLatency),
      medianMs: medianLatency,
      p95Ms: p95Latency,
      p99Ms: p99Latency,
      maxMs: maxLatency
    },
    timestamp: new Date().toISOString()
  };

  console.log(`Results for ${concurrencyLevel} Concurrent Users:`);
  console.log(`  Total Requests: ${totalRequests}`);
  console.log(`  Successful (2xx): ${count2xx}`);
  console.log(`  4xx Errors: ${count4xx}`);
  console.log(`  409 Duplicate Conflicts: ${count409}`);
  console.log(`  429 Rate Limited: ${count429}`);
  console.log(`  5xx Server Errors: ${count5xx}`);
  console.log(`  Timeouts: ${timeoutCount}`);
  console.log(`  Total Duration: ${(totalDurationMs / 1000).toFixed(2)}s (${rps} req/sec)`);
  console.log(`  Latency - Avg: ${Math.round(avgLatency)}ms | Median: ${medianLatency}ms | P95: ${p95Latency}ms | P99: ${p99Latency}ms | Max: ${maxLatency}ms`);

  const rawFilePath = path.join(__dirname, `load_test_${concurrencyLevel}_results.json`);
  fs.writeFileSync(rawFilePath, JSON.stringify(stageSummary, null, 2));
  console.log(`  Raw results saved to: ${rawFilePath}`);

  return stageSummary;
}

(async () => {
  const stages = [100, 250, 500, 1000];
  const allSummaries = [];

  for (const level of stages) {
    const summary = await runStage(level);
    allSummaries.push(summary);
    // 2-second cooldown between stages
    await new Promise(r => setTimeout(r, 2000));
  }

  const fullReportPath = path.join(__dirname, `load_test_full_summary.json`);
  fs.writeFileSync(fullReportPath, JSON.stringify(allSummaries, null, 2));
  console.log(`\n============================================================`);
  console.log(`✅ FULL LOAD TEST SUITE COMPLETED SUCCESSFULLY`);
  console.log(`Summary report saved to: ${fullReportPath}`);
  console.log(`============================================================`);
})();
