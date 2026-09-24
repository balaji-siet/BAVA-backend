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

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function calculatePercentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

let preProvisionedAccounts = [];

async function preProvisionAccounts(count) {
  console.log(`Pre-provisioning ${count} test student accounts (sequentially)...`);
  const accounts = [];
  const runId = Date.now();
  for (let i = 0; i < count; i++) {
    const rollNumber = `REAL_PRE_${runId}_${i}`;
    const email = `real_pre_${runId}_${i}@test.local`;
    const password = 'TestUserPass123!';
    const regRes = await makeRequest('POST', '/api/student/register', {
      name: `Preprovisioned User ${i}`,
      roll_number: rollNumber,
      department: 'CSE',
      email: email,
      password: password
    });
    if (regRes.status === 201) {
      accounts.push({ email, password, rollNumber });
    }
    if ((i + 1) % 250 === 0) {
      console.log(`  Provisioned ${i + 1}/${count} accounts...`);
    }
  }
  console.log(`✅ Successfully pre-provisioned ${accounts.length} test accounts.`);
  return accounts;
}

async function runRealisticVirtualUser(userIndex, totalVirtualUsers) {
  const userResults = [];
  const thinkTime = () => sleep(Math.floor(Math.random() * 400) + 100); // 100-500ms

  // Pick a pre-provisioned account
  const account = preProvisionedAccounts[userIndex % preProvisionedAccounts.length];

  // Determine user intent bucket based on target traffic distribution
  // 70% read, 20% reservation, 8% login, 2% registration
  const dice = Math.random() * 100;

  if (dice < 2) {
    // 2%: Registration
    const newRoll = `REAL_REG_${userIndex}_${Date.now()}`;
    const newEmail = `real_reg_${userIndex}_${Date.now()}@test.local`;
    const rReg = await makeRequest('POST', '/api/student/register', {
      name: `Realistic User ${userIndex}`,
      roll_number: newRoll,
      department: 'ECE',
      email: newEmail,
      password: 'TestUserPass123!'
    });
    userResults.push({ action: 'register', ...rReg });
  } else {
    // Login to get token for subsequent actions
    const rLogin = await makeRequest('POST', '/api/student/login', {
      email: account.email,
      password: account.password
    });
    userResults.push({ action: 'login', ...rLogin });

    const token = rLogin.data && rLogin.data.token;
    if (token) {
      await thinkTime();

      if (dice < 72) {
        // 70% Read Operations (Menu + Meal Settings)
        const rMenu = await makeRequest('GET', '/api/menu/today', null, token);
        userResults.push({ action: 'menu_today', ...rMenu });

        await thinkTime();
        const rSettings = await makeRequest('GET', '/api/meal-settings/today', null, token);
        userResults.push({ action: 'meal_settings', ...rSettings });
      } else if (dice < 92) {
        // 20% Reservation Creation & Cancellation
        const todayStr = new Date().toISOString().split('T')[0];
        const rReserve = await makeRequest('POST', '/api/reservations/create', {
          date: todayStr,
          meals: ['lunch']
        }, token);
        userResults.push({ action: 'reserve_create', ...rReserve });

        await thinkTime();
        const rCancel = await makeRequest('POST', '/api/cancel-reservation', {
          date: todayStr,
          mealType: 'lunch'
        }, token);
        userResults.push({ action: 'reserve_cancel', ...rCancel });
      } else {
        // 8% Login + History check
        const rHist = await requestHistory(token);
        userResults.push({ action: 'history_check', ...rHist });
      }
    }
  }

  return userResults;
}

function requestHistory(token) {
  return makeRequest('GET', '/api/reservations/history', null, token);
}

async function runStage(concurrencyLevel) {
  console.log(`\n============================================================`);
  console.log(`RUNNING REALISTIC TRAFFIC STAGE: ${concurrencyLevel} CONCURRENT USERS`);
  console.log(`============================================================`);

  const startTime = Date.now();
  const userPromises = [];
  for (let i = 0; i < concurrencyLevel; i++) {
    userPromises.push(runRealisticVirtualUser(i, concurrencyLevel));
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
  const successRate = ((successCount / totalRequests) * 100).toFixed(1);

  const stageSummary = {
    concurrencyLevel,
    totalRequests,
    successCount,
    failCount,
    successRate: parseFloat(successRate),
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

  console.log(`Results for ${concurrencyLevel} Concurrent Users (Realistic Profile):`);
  console.log(`  Total Requests: ${totalRequests}`);
  console.log(`  Successful (2xx): ${count2xx} (${successRate}%)`);
  console.log(`  4xx Errors: ${count4xx}`);
  console.log(`  409 Conflicts: ${count409}`);
  console.log(`  429 Rate Limited: ${count429}`);
  console.log(`  5xx Server Errors: ${count5xx}`);
  console.log(`  Timeouts: ${timeoutCount}`);
  console.log(`  Total Duration: ${(totalDurationMs / 1000).toFixed(2)}s (${rps} req/sec)`);
  console.log(`  Latency - Avg: ${Math.round(avgLatency)}ms | Median: ${medianLatency}ms | P95: ${p95Latency}ms | P99: ${p99Latency}ms | Max: ${maxLatency}ms`);

  const rawFilePath = path.join(__dirname, `realistic_load_test_${concurrencyLevel}.json`);
  fs.writeFileSync(rawFilePath, JSON.stringify(stageSummary, null, 2));
  console.log(`  Raw results saved to: ${rawFilePath}`);

  return stageSummary;
}

(async () => {
  preProvisionedAccounts = await preProvisionAccounts(1000);

  const stages = [100, 250, 500, 1000];
  const allSummaries = [];

  for (const level of stages) {
    const summary = await runStage(level);
    allSummaries.push(summary);
    await sleep(2000);
  }

  const fullReportPath = path.join(__dirname, `realistic_load_test_summary.json`);
  fs.writeFileSync(fullReportPath, JSON.stringify(allSummaries, null, 2));
  console.log(`\n============================================================`);
  console.log(`✅ REALISTIC LOAD TEST SUITE COMPLETED SUCCESSFULLY`);
  console.log(`Summary report saved to: ${fullReportPath}`);
  console.log(`============================================================`);
})();
