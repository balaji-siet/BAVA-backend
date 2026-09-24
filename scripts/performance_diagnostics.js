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
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000
    };

    if (token) options.headers['Authorization'] = `Bearer ${token}`;

    const startTime = Date.now();
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const duration = Date.now() - startTime;
        let parsed = null;
        try { parsed = JSON.parse(data); } catch (e) {}
        resolve({ status: res.statusCode, duration, error: null, data: parsed });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, duration: Date.now() - startTime, error: 'TIMEOUT', data: null });
    });

    req.on('error', (err) => {
      resolve({ status: 0, duration: Date.now() - startTime, error: err.code || err.message, data: null });
    });

    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function measureEventLoopLag(durationMs = 1000) {
  return new Promise((resolve) => {
    const start = Date.now();
    let maxLag = 0;
    let lastCheck = start;

    const interval = setInterval(() => {
      const now = Date.now();
      const lag = now - lastCheck - 50; // 50ms expected interval
      if (lag > maxLag) maxLag = lag;
      lastCheck = now;

      if (now - start >= durationMs) {
        clearInterval(interval);
        resolve(Math.max(0, maxLag));
      }
    }, 50);
  });
}

function calculatePercentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

async function runPerformanceDiagnostics() {
  console.log("============================================================");
  console.log("PERFORMANCE DIAGNOSTICS & EVENT-LOOP MONITORING SUITE");
  console.log("============================================================");

  // 1. Measure Baseline Event-Loop Lag under idle
  const idleLag = await measureEventLoopLag(1000);
  console.log(`1. Idle Event-Loop Lag: ${idleLag} ms`);

  // 2. Fetch Diagnostics endpoint
  console.log("2. Querying Backend Health & Diagnostics...");
  const diagRes = await makeRequest('GET', '/api/diagnostics');
  console.log("   Diagnostics Data:", diagRes.data);

  // 3. Obtain JWT Token
  console.log("3. Authenticating test account...");
  const authRes = await makeRequest('POST', '/api/student/login', {
    email: 'real_pre_1786355810000_0@test.local',
    password: 'TestUserPass123!'
  });
  const token = authRes.data && authRes.data.token;
  console.log(`   Token Acquired: ${Boolean(token)}`);

  // 4. Measure 500-User Event-Loop Lag & Latency during concurrent burst
  console.log("4. Measuring 500-User Concurrent Burst Latency & Event Loop Lag...");
  const lagPromise = measureEventLoopLag(3000);
  const burstStartTime = Date.now();
  const promises = Array.from({ length: 500 }, (_, i) => {
    if (i % 2 === 0) {
      return makeRequest('GET', '/api/menu/today', null, token);
    } else {
      return makeRequest('POST', '/api/reservations/create', { date: '2026-08-25', meals: ['lunch'] }, token);
    }
  });

  const [burstResults, burstLag] = await Promise.all([Promise.all(promises), lagPromise]);
  const burstDuration = Date.now() - burstStartTime;

  const latencies = burstResults.map(r => r.duration);
  const success2xx = burstResults.filter(r => r.status >= 200 && r.status < 300).length;
  const timeouts = burstResults.filter(r => r.error === 'TIMEOUT').length;

  const summary = {
    idleEventLoopLagMs: idleLag,
    burstEventLoopLagMs: burstLag,
    burstConcurrency: 500,
    burstTotalRequests: 500,
    burstSuccess2xx: success2xx,
    burstTimeouts: timeouts,
    burstDurationMs: burstDuration,
    burstRps: parseFloat((500 / (burstDuration / 1000)).toFixed(2)),
    latency: {
      averageMs: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
      p50Ms: calculatePercentile(latencies, 50),
      p95Ms: calculatePercentile(latencies, 95),
      p99Ms: calculatePercentile(latencies, 99),
      maxMs: Math.max(...latencies)
    },
    diagnosticsInfo: diagRes.data
  };

  console.log("\n============================================================");
  console.log("DIAGNOSTICS SUMMARY:");
  console.log(`  Burst Success: ${success2xx}/500 (${((success2xx/500)*100).toFixed(1)}%) | Timeouts: ${timeouts}`);
  console.log(`  Event-Loop Lag during burst: ${burstLag} ms`);
  console.log(`  P50 Latency: ${summary.latency.p50Ms}ms | P95: ${summary.latency.p95Ms}ms | Max: ${summary.latency.maxMs}ms`);
  console.log("============================================================");

  const reportPath = path.join(__dirname, 'performance_diagnostics_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2));
  console.log(`Saved performance diagnostics report to: ${reportPath}`);
}

runPerformanceDiagnostics().catch(console.error);
