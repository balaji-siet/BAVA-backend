const crypto = require('crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Student = require('../src/models/Student');
const Reservation = require('../src/models/Reservation');
const MealSettings = require('../src/models/MealSettings');
const { hashDeviceToken } = require('../src/controllers/reservationDeviceController');
const { saveReservations } = require('../src/controllers/reservationController');
const { parseIndiaDateTime, getReservationWindowStatus } = require('../src/utils/reservationWindow');

let mongod = null;

function assertLocalTestDb(uri) {
  const parsed = new URL(uri);
  const dbName = parsed.pathname.replace('/', '');
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || dbName !== 'smartmess_test') {
    throw new Error('Refusing to run timing regression outside isolated smartmess_test database.');
  }
}

function mockReqRes({ body, headers, userId, userRoll }) {
  return new Promise((resolve) => {
    const req = { body, headers, userId, userRoll, userRole: 'student', query: {} };
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        resolve({ status: this.statusCode, data });
        return this;
      }
    };
    saveReservations(req, res).catch(err => resolve({ status: 500, data: { error: err.message } }));
  });
}

async function seedStudent() {
  const stamp = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const deviceToken = `timing_device_${stamp}`;
  const roll = `TIME_${stamp}`;
  const student = await Student.create({
    name: 'Timing Regression Student',
    roll_number: roll,
    department: 'CSE',
    email: `${roll.toLowerCase()}@test.local`,
    password: '$2b$10$RegressionOnlyHashPlaceholder1234567890123456789012',
    status: 'active',
    reservationDeviceTokenHash: hashDeviceToken(deviceToken),
    reservationDeviceBoundAt: new Date(),
    reservationDeviceLastUsedAt: new Date(),
  });
  return { student, roll, deviceToken };
}

async function saveSchedule(date, windows) {
  await MealSettings.findOneAndUpdate(
    { date },
    { $set: { ...windows, updatedBy: 'Timing Regression' } },
    { upsert: true, returnDocument: 'after' }
  );
}

async function reserveMeal({ student, roll, deviceToken, date, meal }) {
  return mockReqRes({
    userId: student._id.toString(),
    userRoll: roll,
    headers: { 'x-smartmess-device-token': deviceToken, 'x-operation-id': `op_${meal}_${date}_${Date.now()}_${Math.random()}` },
    body: { date, meal_type: meal, [meal]: true }
  });
}

(async () => {
  console.log('============================================================');
  console.log('SMART MESS — RESERVATION TIMING / CUTOFF REGRESSION');
  console.log('============================================================');

  let mongoUri = process.env.MONGODB_URI;
  if (mongoUri) {
    assertLocalTestDb(mongoUri);
  } else {
    mongod = await MongoMemoryServer.create({ instance: { dbName: 'smartmess_test' } });
    mongoUri = mongod.getUri();
  }

  await mongoose.connect(mongoUri);
  await Promise.all([Student.syncIndexes(), Reservation.syncIndexes(), MealSettings.syncIndexes()]);

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

  const date = '2026-09-15';
  const { student, roll, deviceToken } = await seedStudent();

  check(parseIndiaDateTime('2026-09-15', '00:00').toISOString() === '2026-09-14T18:30:00.000Z', '12:00 AM canonical boundary maps to 00:00 IST');
  check(parseIndiaDateTime('2026-09-15', '12:00').toISOString() === '2026-09-15T06:30:00.000Z', '12:00 PM canonical boundary maps to 12:00 IST');

  process.env.DEBUG_NOW_IST = '2026-09-15 09:00';
  let missing = await getReservationWindowStatus('breakfast', '2026-09-19');
  check(missing.allowed === false && missing.code === 'SCHEDULE_NOT_AVAILABLE', 'missing schedule blocks safely', missing.code);

  await saveSchedule(date, {
    breakfast: { open_time: '20:00', close_time: '06:30', open_date: '2026-09-14', close_date: '2026-09-15', enabled: true, sms_sent: false },
    lunch: { open_time: '07:00', close_time: '11:00', open_date: '2026-09-15', close_date: '2026-09-15', enabled: true, sms_sent: false },
    dinner: { open_time: '13:00', close_time: '18:00', open_date: '2026-09-15', close_date: '2026-09-15', enabled: true, sms_sent: false },
  });

  process.env.DEBUG_NOW_IST = '2026-09-14 19:59';
  let before = await reserveMeal({ student, roll, deviceToken, date, meal: 'breakfast' });
  check(before.status === 403 && before.data.code === 'RESERVATION_NOT_OPEN', 'before opening is blocked', `status=${before.status}, code=${before.data.code}`);

  process.env.DEBUG_NOW_IST = '2026-09-14 20:00';
  let opening = await reserveMeal({ student, roll, deviceToken, date, meal: 'breakfast' });
  check(opening.status === 200, 'exact opening boundary is allowed', `status=${opening.status}`);

  process.env.DEBUG_NOW_IST = '2026-09-15 06:30';
  let cutoff = await reserveMeal({ student, roll, deviceToken, date, meal: 'breakfast' });
  check(cutoff.status === 200, 'exact cutoff boundary is allowed', `status=${cutoff.status}`);

  process.env.DEBUG_NOW_IST = '2026-09-15 06:31';
  const countBeforeClosedAttempt = await Reservation.countDocuments({ reservation_date: date, breakfast: true });
  let closed = await reserveMeal({ student, roll, deviceToken, date, meal: 'breakfast' });
  const countAfterClosedAttempt = await Reservation.countDocuments({ reservation_date: date, breakfast: true });
  check(closed.status === 403 && closed.data.code === 'RESERVATION_CLOSED', 'after cutoff is blocked', `status=${closed.status}, code=${closed.data.code}`);
  check(countAfterClosedAttempt === countBeforeClosedAttempt, 'closed attempt does not change supervisor count', `${countBeforeClosedAttempt} -> ${countAfterClosedAttempt}`);

  process.env.DEBUG_NOW_IST = '2026-09-15 09:00';
  const lunch = await getReservationWindowStatus('lunch', date);
  const dinner = await getReservationWindowStatus('dinner', date);
  check(lunch.allowed === true && dinner.allowed === false, 'meal isolation keeps lunch open and dinner unopened', `lunch=${lunch.code}, dinner=${dinner.code}`);

  console.log('============================================================');
  console.log(`RESERVATION TIMING / CUTOFF SUMMARY: ${passed} PASSED | ${failed} FAILED`);
  console.log('============================================================');

  delete process.env.DEBUG_NOW_IST;
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
  if (failed > 0) process.exit(1);
})().catch(async (err) => {
  console.error('Reservation timing cutoff regression failed:', err.message);
  delete process.env.DEBUG_NOW_IST;
  try { await mongoose.disconnect(); } catch (e) {}
  try { if (mongod) await mongod.stop(); } catch (e) {}
  process.exit(1);
});
