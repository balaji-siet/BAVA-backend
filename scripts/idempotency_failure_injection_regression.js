const http = require('http');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const Reservation = require('../src/models/Reservation');
const IdempotencyKey = require('../src/models/IdempotencyKey');
const Student = require('../src/models/Student');
const MealSettings = require('../src/models/MealSettings');
const { hashDeviceToken } = require('../src/controllers/reservationDeviceController');

const BASE_URL = 'http://localhost:5000';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/smartmess_test';
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_mess_token_123!';

function assertLocalTestDb() {
  const parsed = new URL(MONGODB_URI);
  const dbName = parsed.pathname.replace('/', '');
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || dbName !== 'smartmess_test') {
    throw new Error('Refusing to seed schedules outside isolated smartmess_test database.');
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
      timeout: 15000,
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
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, error: 'timeout', data: null });
    });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function registerAndBindStudent() {
  const stamp = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const deviceToken = `idem_device_${stamp}`;
  const email = `idem_${stamp}@test.local`;
  const roll = `IDEM_${stamp}`;

  const student = await Student.create({
    name: 'Idempotency Regression Student',
    roll_number: roll,
    department: 'CSE',
    email,
    password: '$2b$10$RegressionOnlyHashPlaceholder1234567890123456789012',
    status: 'active',
    reservationDeviceTokenHash: hashDeviceToken(deviceToken),
    reservationDeviceBoundAt: new Date(),
    reservationDeviceLastUsedAt: new Date(),
  });

  const token = jwt.sign({ studentId: student._id.toString(), rollNumber: roll, role: 'student' }, JWT_SECRET, { expiresIn: '1h', algorithm: 'HS256' });
  return { token, roll, headers: { 'X-SmartMess-Device-Token': deviceToken } };
}

async function seedOpenSchedule(date) {
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

async function getCounts(date, token) {
  const res = await makeRequest('GET', `/api/reservations/counts?date=${encodeURIComponent(date)}`, null, token);
  if (res.status !== 200) throw new Error(`count query failed: ${res.status}`);
  return res.data;
}

(async () => {
  console.log('============================================================');
  console.log('SMART MESS — IDEMPOTENCY FAILURE INJECTION REGRESSION');
  console.log('============================================================');

  assertLocalTestDb();
  await mongoose.connect(MONGODB_URI);

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

  const student = await registerAndBindStudent();
  const date = `2026-11-${String(Math.floor(Math.random() * 20) + 1).padStart(2, '0')}`;
  await seedOpenSchedule(date);
  const reserveOperationId = `reserve_loss_${student.roll}`;
  const cancelOperationId = `cancel_loss_${student.roll}`;
  const headers = { ...student.headers, 'X-Operation-Id': reserveOperationId };
  const reservePayload = { date, breakfast: true, lunch: false, dinner: false };

  const firstReserve = await makeRequest('POST', '/api/reservations/create', reservePayload, student.token, headers);
  check(firstReserve.status === 200, 'reserve first acknowledged success', `status=${firstReserve.status}`);
  check(Boolean(await IdempotencyKey.findOne({ key: reserveOperationId }).lean()), 'reserve idempotency durable before retry');

  const replayReserve = await makeRequest('POST', '/api/reservations/create', reservePayload, student.token, headers);
  const reserveCount = await Reservation.countDocuments({ reservation_date: date, breakfast: true });
  const reserveDocs = await Reservation.find({ reservation_date: date, roll_number: student.roll }).lean();
  const supervisorAfterReserve = await getCounts(date, student.token);

  check(replayReserve.status === 200, 'reserve replay after simulated response loss succeeds', `status=${replayReserve.status}`);
  check(reserveDocs.length === 1, 'reserve replay keeps one logical reservation', `docs=${reserveDocs.length}`);
  check(reserveCount === 1 && supervisorAfterReserve.breakfast === 1, 'reserve replay keeps supervisor count at one', `mongo=${reserveCount}, supervisor=${supervisorAfterReserve.breakfast}`);

  const cancelHeaders = { ...student.headers, 'X-Operation-Id': cancelOperationId };
  const firstCancel = await makeRequest('POST', '/api/cancel-reservation', { date, meal_type: 'breakfast' }, student.token, cancelHeaders);
  check(firstCancel.status === 200, 'cancel first acknowledged success', `status=${firstCancel.status}`);
  check(Boolean(await IdempotencyKey.findOne({ key: cancelOperationId }).lean()), 'cancel idempotency durable before retry');

  const replayCancel = await makeRequest('POST', '/api/cancel-reservation', { date, meal_type: 'breakfast' }, student.token, cancelHeaders);
  const activeAfterCancel = await Reservation.countDocuments({ reservation_date: date, breakfast: true });
  const supervisorAfterCancel = await getCounts(date, student.token);
  const cancelDoc = await Reservation.findOne({ reservation_date: date, roll_number: student.roll }).lean();

  check(replayCancel.status === 200, 'cancel replay after simulated response loss succeeds', `status=${replayCancel.status}`);
  check(cancelDoc && cancelDoc.breakfast === false, 'cancel replay keeps one logical cancellation');
  check(activeAfterCancel === 0 && supervisorAfterCancel.breakfast === 0, 'cancel replay keeps supervisor count decremented once', `mongo=${activeAfterCancel}, supervisor=${supervisorAfterCancel.breakfast}`);

  console.log('============================================================');
  console.log(`IDEMPOTENCY FAILURE INJECTION SUMMARY: ${passed} PASSED | ${failed} FAILED`);
  console.log('============================================================');

  await mongoose.disconnect();
  if (failed > 0) process.exit(1);
})().catch(async (err) => {
  console.error('Idempotency failure injection regression failed:', err.message);
  try { await mongoose.disconnect(); } catch (e) {}
  process.exit(1);
});
