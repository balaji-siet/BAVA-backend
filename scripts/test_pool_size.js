const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000
    };
    if (token) options.headers['Authorization'] = `Bearer ${token}`;

    const startTime = Date.now();
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        resolve({ status: res.statusCode, duration: Date.now() - startTime, error: null });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, duration: Date.now() - startTime, error: 'TIMEOUT' }); });
    req.on('error', (err) => { resolve({ status: 0, duration: Date.now() - startTime, error: err.code }); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function calculatePercentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

async function runWriteTest(count, token) {
  const startTime = Date.now();
  const promises = Array.from({ length: count }, () =>
    makeRequest('POST', '/api/reservations/create', { date: '2026-08-20', meals: ['lunch'] }, token)
  );
  const results = await Promise.all(promises);
  const durationMs = Date.now() - startTime;
  const latencies = results.map(r => r.duration);
  const success2xx = results.filter(r => r.status >= 200 && r.status < 300).length;
  const timeouts = results.filter(r => r.error === 'TIMEOUT').length;

  return {
    totalRequests: count,
    success2xx,
    timeouts,
    durationMs,
    rps: parseFloat((count / (durationMs / 1000)).toFixed(2)),
    p50Ms: calculatePercentile(latencies, 50),
    p95Ms: calculatePercentile(latencies, 95)
  };
}

(async () => {
  console.log("============================================================");
  console.log("PHASE 3 — MONGOOSE POOL SIZE COMPARISON BENCHMARK");
  console.log("============================================================");

  // Authenticate
  const authRes = await makeRequest('POST', '/api/student/login', {
    email: 'real_pre_1786355810000_0@test.local',
    password: 'TestUserPass123!'
  });
  let token = authRes.data && authRes.data.token;
  if (!token) {
    const lRes = await makeRequest('POST', '/api/student/login', {
      email: 'real_pre_1786355810000_0@test.local',
      password: 'TestUserPass123!'
    });
    token = lRes.data && lRes.data.token;
  }

  // Run write benchmark on current pool size (20)
  console.log("\nTesting current maxPoolSize: 20 (500 write requests)...");
  const res20 = await runWriteTest(500, token);
  console.log("Result (maxPoolSize=20):", res20);

  const reportPath = path.join(__dirname, 'pool_size_comparison.json');
  fs.writeFileSync(reportPath, JSON.stringify({ maxPoolSize_20: res20 }, null, 2));
})();
