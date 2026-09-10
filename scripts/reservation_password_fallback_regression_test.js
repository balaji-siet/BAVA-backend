const http = require('http');
const mongoose = require('mongoose');
const MealSettings = require('../src/models/MealSettings');

const BASE_URL = 'http://localhost:5000';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/smartmess_test';

function assertLocalTestDb() {
  const parsed = new URL(MONGODB_URI);
  const dbName = parsed.pathname.replace('/', '');
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || dbName !== 'smartmess_test') {
    throw new Error('Refusing to seed schedules outside isolated smartmess_test database.');
  }
}

async function seedOpenSchedules(dates) {
  for (const date of dates) {
    await MealSettings.findOneAndUpdate(
      { date },
      {
        $set: {
          breakfast: { open_time: '00:00', close_time: '23:59', open_date: '2026-09-01', close_date: '2026-12-31', enabled: true, sms_sent: false },
          lunch: { open_time: '00:00', close_time: '23:59', open_date: '2026-09-01', close_date: '2026-12-31', enabled: true, sms_sent: false },
          dinner: { open_time: '00:00', close_time: '23:59', open_date: '2026-09-01', close_date: '2026-12-31', enabled: true, sms_sent: false },
          updatedBy: 'Regression'
        }
      },
      { upsert: true }
    );
  }
}

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

async function registerAndLogin(label) {
  const stamp = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const password = `MealPass_${stamp}!`;
  const email = `${label}_${stamp}@test.local`;
  const roll = `${label}_${stamp}`;
  await makeRequest('POST', '/api/student/register', {
    name: `${label} Student`,
    roll_number: roll,
    department: 'CSE',
    email,
    password,
  });
  const login = await makeRequest('POST', '/api/student/login', { email, password });
  const token = login.data && login.data.token;
  if (!token) throw new Error(`Login failed for ${label}`);
  return { token, password, roll };
}

function pass(label, detail = '') {
  console.log(`  [PASS] ${label}${detail ? ` (${detail})` : ''}`);
}

(async () => {
  console.log('============================================================');
  console.log('SMART MESS — HYBRID MEAL PASSWORD FALLBACK REGRESSION');
  console.log('============================================================');

  let passed = 0;
  let failed = 0;
  const check = (condition, label, detail = '') => {
    if (condition) {
      pass(label, detail);
      passed++;
    } else {
      console.error(`  [FAIL] ${label}${detail ? ` (${detail})` : ''}`);
      failed++;
    }
  };

  assertLocalTestDb();
  await mongoose.connect(MONGODB_URI);
  await seedOpenSchedules(['2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06']);

  const student = await registerAndLogin('meal_password');
  const enroll = await makeRequest('POST', '/api/reservation-device/enroll', null, student.token);
  const deviceToken = enroll.data && enroll.data.deviceToken;
  check(enroll.status === 201 && Boolean(deviceToken), 'registered device enrollment succeeds', `status=${enroll.status}`);

  const deviceHeaders = { 'X-SmartMess-Device-Token': deviceToken };
  const passwordHeaders = { ...deviceHeaders, 'X-SmartMess-Meal-Password': student.password };

  const fingerprintModeReserve = await makeRequest('POST', '/api/reservations/create', {
    date: '2026-09-02', breakfast: true, lunch: false, dinner: false,
  }, student.token, deviceHeaders);
  check(fingerprintModeReserve.status === 200, 'fingerprint/device-token path still reserves without password', `status=${fingerprintModeReserve.status}`);

  const passwordModeReserve = await makeRequest('POST', '/api/reservations/create', {
    date: '2026-09-03', breakfast: true, lunch: true, dinner: false,
  }, student.token, passwordHeaders);
  check(passwordModeReserve.status === 200, 'correct password plus registered device reserves', `status=${passwordModeReserve.status}`);

  const wrongPasswordReserve = await makeRequest('POST', '/api/reservations/create', {
    date: '2026-09-04', breakfast: true, lunch: false, dinner: false,
  }, student.token, { ...deviceHeaders, 'X-SmartMess-Meal-Password': 'wrong-password' });
  check(wrongPasswordReserve.status === 403 && wrongPasswordReserve.data?.code === 'MEAL_PASSWORD_INVALID', 'incorrect password blocks reserve', `status=${wrongPasswordReserve.status}`);

  const cancelWithPassword = await makeRequest('POST', '/api/cancel-reservation', {
    date: '2026-09-03', meal_type: 'lunch',
  }, student.token, passwordHeaders);
  check(cancelWithPassword.status === 200, 'cancel accepts fresh correct password plus registered device', `status=${cancelWithPassword.status}`);

  const cancelWrongPassword = await makeRequest('POST', '/api/cancel-reservation', {
    date: '2026-09-03', meal_type: 'breakfast',
  }, student.token, { ...deviceHeaders, 'X-SmartMess-Meal-Password': 'wrong-password' });
  check(cancelWrongPassword.status === 403 && cancelWrongPassword.data?.code === 'MEAL_PASSWORD_INVALID', 'incorrect password blocks cancel', `status=${cancelWrongPassword.status}`);

  const wrongDeviceReserve = await makeRequest('POST', '/api/reservations/create', {
    date: '2026-09-05', breakfast: true, lunch: false, dinner: false,
  }, student.token, { 'X-SmartMess-Device-Token': 'wrong-device-token', 'X-SmartMess-Meal-Password': student.password });
  check(wrongDeviceReserve.status === 403 && wrongDeviceReserve.data?.code === 'DEVICE_BINDING_INVALID', 'correct password on wrong device blocks reserve', `status=${wrongDeviceReserve.status}`);

  const wrongDeviceCancel = await makeRequest('POST', '/api/cancel-reservation', {
    date: '2026-09-03', meal_type: 'breakfast',
  }, student.token, { 'X-SmartMess-Device-Token': 'wrong-device-token', 'X-SmartMess-Meal-Password': student.password });
  check(wrongDeviceCancel.status === 403 && wrongDeviceCancel.data?.code === 'DEVICE_BINDING_INVALID', 'correct password on wrong device blocks cancel', `status=${wrongDeviceCancel.status}`);

  const otherStudent = await registerAndLogin('other_phone');
  const otherAttempt = await makeRequest('POST', '/api/reservations/create', {
    date: '2026-09-06', breakfast: true, lunch: false, dinner: false,
  }, otherStudent.token, { 'X-SmartMess-Device-Token': deviceToken, 'X-SmartMess-Meal-Password': otherStudent.password });
  check(otherAttempt.status === 403, 'registered device token cannot be reused by another account', `status=${otherAttempt.status}`);

  console.log('============================================================');
  console.log(`HYBRID MEAL PASSWORD FALLBACK SUMMARY: ${passed} PASSED | ${failed} FAILED`);
  console.log('============================================================');
  await mongoose.disconnect();
  if (failed > 0) process.exit(1);
})().catch((err) => {
  console.error('Hybrid meal password fallback regression failed:', err.message);
  mongoose.disconnect().finally(() => process.exit(1));
});
