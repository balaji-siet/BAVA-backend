const http = require('http');
const BASE_URL = 'http://localhost:5000';

function makeRequest(method, pathStr, body = null, token = null, extraHeaders = {}) {
  return new Promise((resolve) => {
    const url = new URL(pathStr, BASE_URL);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      timeout: 10000,
    };
    if (token) options.headers.Authorization = `Bearer ${token}`;
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch (e) {}
        resolve({ status: res.statusCode, data: parsed });
      });
    });
    req.on('error', err => resolve({ status: 0, error: err.message, data: null }));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function registerAndBindStudent(meal) {
  const stamp = `${Date.now()}_${meal}_${Math.floor(Math.random() * 100000)}`;
  const password = `FullFlow_${stamp}!`;
  const email = `full_${stamp}@test.local`;
  const roll = `FULL_${stamp}`;
  const register = await makeRequest('POST', '/api/student/register', {
    name: `Full Flow ${meal}`,
    roll_number: roll,
    department: 'CSE',
    email,
    password,
  });
  if (register.status !== 201) throw new Error(`register failed for ${meal}: ${register.status}`);
  const login = await makeRequest('POST', '/api/student/login', { email, password });
  const token = login.data && login.data.token;
  if (!token) throw new Error(`login failed for ${meal}: ${login.status}`);
  const enroll = await makeRequest('POST', '/api/reservation-device/enroll', null, token);
  const deviceToken = enroll.data && enroll.data.deviceToken;
  if (enroll.status !== 201 || !deviceToken) throw new Error(`device bind failed for ${meal}: ${enroll.status}`);
  return { token, roll, password, headers: { 'X-SmartMess-Device-Token': deviceToken } };
}

async function getCounts(date, token) {
  const res = await makeRequest('GET', `/api/reservations/counts?date=${encodeURIComponent(date)}`, null, token);
  if (res.status !== 200) throw new Error(`count query failed: ${res.status}`);
  return res.data;
}

async function getStudentReservation(date, token) {
  const res = await makeRequest('GET', `/api/reservations/today?date=${encodeURIComponent(date)}`, null, token);
  if (res.status !== 200) throw new Error(`student reservation query failed: ${res.status}`);
  return res.data.reservations;
}

(async () => {
  console.log('============================================================');
  console.log('SMART MESS — FULL FUNCTIONAL RESERVATION COUNT REGRESSION');
  console.log('============================================================');

  let passed = 0;
  let failed = 0;
  const check = (condition, label, detail = '') => {
    if (condition) {
      console.log(`  [PASS] ${label}${detail ? ` (${detail})` : ''}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${label}${detail ? ` (${detail})` : ''}`);
      failed++;
    }
  };

  for (const meal of ['breakfast', 'lunch', 'dinner']) {
    const date = `2026-10-${meal === 'breakfast' ? '11' : meal === 'lunch' ? '12' : '13'}`;
    const student = await registerAndBindStudent(meal);
    const before = await getCounts(date, student.token);
    check(before[meal] === 0, `${meal} starts from zero active reservations`, `count=${before[meal]}`);

    const payload = { date, breakfast: false, lunch: false, dinner: false, [meal]: true };
    const reserve = await makeRequest('POST', '/api/reservations/create', payload, student.token, student.headers);
    check(reserve.status === 200, `${meal} reserve HTTP success`, `status=${reserve.status}`);

    const afterReserve = await getCounts(date, student.token);
    const studentState = await getStudentReservation(date, student.token);
    check(afterReserve[meal] === before[meal] + 1, `${meal} supervisor count increments by one`, `${before[meal]} -> ${afterReserve[meal]}`);
    check(studentState[meal] === true, `${meal} student state shows reserved`);

    const duplicate = await makeRequest('POST', '/api/reservations/create', payload, student.token, student.headers);
    const afterDuplicate = await getCounts(date, student.token);
    check(duplicate.status === 200 && afterDuplicate[meal] === afterReserve[meal], `${meal} duplicate reserve does not double count`, `count=${afterDuplicate[meal]}`);

    const cancel = await makeRequest('POST', '/api/cancel-reservation', { date, meal_type: meal }, student.token, student.headers);
    check(cancel.status === 200, `${meal} cancel HTTP success`, `status=${cancel.status}`);
    const afterCancel = await getCounts(date, student.token);
    const studentAfterCancel = await getStudentReservation(date, student.token);
    check(afterCancel[meal] === before[meal], `${meal} supervisor count decrements exactly once`, `${afterReserve[meal]} -> ${afterCancel[meal]}`);
    check(studentAfterCancel[meal] === false, `${meal} student state shows not reserved after cancel`);
  }

  console.log('============================================================');
  console.log(`FULL FUNCTIONAL RESERVATION COUNT SUMMARY: ${passed} PASSED | ${failed} FAILED`);
  console.log('============================================================');
  if (failed > 0) process.exit(1);
})().catch((err) => {
  console.error('Full functional reservation count regression failed:', err.message);
  process.exit(1);
});
