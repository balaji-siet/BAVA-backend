const http = require('http');
const BASE_URL = 'http://localhost:5000';

function makeRequest(method, pathStr, body = null, token = null) {
  return new Promise((resolve) => {
    const url = new URL(pathStr, BASE_URL);
    const options = {
      method: method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000
    };

    if (token) options.headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch (e) {}
        resolve({ status: res.statusCode, data: parsed });
      });
    });

    req.on('error', (err) => resolve({ status: 0, error: err.message, data: null }));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runConcurrencyIntegrityTests() {
  console.log("============================================================");
  console.log("DATA INTEGRITY & CONCURRENCY RACE CONDITION TEST SUITE");
  console.log("============================================================");

  let passed = 0;
  let failed = 0;

  const testEmail = `concurrency_student_${Date.now()}@test.local`;
  const testRoll = `CONC_ROLL_${Date.now()}`;
  const testPass = 'TestPass123!';

  // Register clean student account
  await makeRequest('POST', '/api/student/register', {
    name: 'Concurrency Test Student',
    roll_number: testRoll,
    department: 'ECE',
    email: testEmail,
    password: testPass
  });

  // Authenticate test account
  const authRes = await makeRequest('POST', '/api/student/login', {
    email: testEmail,
    password: testPass
  });

  const token = authRes.data && authRes.data.token;
  console.log(`1. Test Account Authentication: ${token ? 'SUCCESS' : 'FAILED'}`);
  if (!token) {
    console.error("❌ Authentication failed. Cannot proceed with concurrency testing.");
    process.exit(1);
  }

  // TEST SCENARIO A: 10 Concurrent Meal Reservation Requests
  console.log("\n2. TEST SCENARIO A: 10 Concurrent Meal Reservation Requests for same student...");
  const dateStr = '2026-09-01';
  const resPromises = Array.from({ length: 10 }, (_, i) => {
    return makeRequest('POST', '/api/reservations/create', {
      date: dateStr,
      breakfast: true,
      lunch: i % 2 === 0,
      dinner: true
    }, token);
  });

  const resResults = await Promise.all(resPromises);
  const resStatuses = resResults.map(r => r.status);
  const resSuccessCount = resStatuses.filter(s => s === 200).length;
  console.log(`   Reservation Results: ${resSuccessCount}/10 succeeded (Statuses: ${resStatuses.join(', ')})`);

  // Verify history query count
  const historyRes = await makeRequest('GET', `/api/reservations/history`, null, token);
  const targetDoc = historyRes.data && Array.isArray(historyRes.data) ? historyRes.data.find(r => r.reservation_date === dateStr) : null;
  console.log(`   Verification in DB: Document exists? ${Boolean(targetDoc)} | Breakfast: ${targetDoc?.breakfast}`);

  if (resSuccessCount === 10 && targetDoc) {
    console.log("   ✅ TEST SCENARIO A PASSED — Concurrent reservations handled safely");
    passed++;
  } else {
    console.error("   ❌ TEST SCENARIO A FAILED");
    failed++;
  }

  // TEST SCENARIO B: Simultaneous Duplicate Student Registration
  console.log("\n3. TEST SCENARIO B: 10 Concurrent Duplicate Registration Requests...");
  const dupRoll = `RACE_ROLL_${Date.now()}`;
  const dupEmail = `race_${Date.now()}@test.local`;

  const regPromises = Array.from({ length: 10 }, () => {
    return makeRequest('POST', '/api/student/register', {
      name: 'Race Condition Student',
      roll_number: dupRoll,
      department: 'CSE',
      email: dupEmail,
      password: 'RacePassword123!'
    });
  });

  const regResults = await Promise.all(regPromises);
  const regStatuses = regResults.map(r => r.status);
  const createdCount = regStatuses.filter(s => s === 201).length;
  const rejectedCount = regStatuses.filter(s => s === 400).length;

  console.log(`   Registration Results: Created: ${createdCount} | Rejected: ${rejectedCount} (Statuses: ${regStatuses.join(', ')})`);

  if (createdCount === 1 && rejectedCount === 9) {
    console.log("   ✅ TEST SCENARIO B PASSED — Exactly 1 account created, 9 rejected cleanly with HTTP 400");
    passed++;
  } else {
    console.error(`   ❌ TEST SCENARIO B FAILED — Created: ${createdCount}, Rejected: ${rejectedCount}`);
    failed++;
  }

  // SUMMARY
  console.log("\n============================================================");
  console.log(`CONCURRENCY INTEGRITY SUMMARY: ${passed} PASSED | ${failed} FAILED`);
  console.log("============================================================");

  if (failed > 0) process.exit(1);
}

runConcurrencyIntegrityTests().catch(console.error);
