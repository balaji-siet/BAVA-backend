const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Reservation = require('../src/models/Reservation');
const IdempotencyKey = require('../src/models/IdempotencyKey');
const Student = require('../src/models/Student');
const MealSettings = require('../src/models/MealSettings');

function hasCollscan(plan) {
  return JSON.stringify(plan).includes('COLLSCAN');
}

function findIndexName(node) {
  if (!node || typeof node !== 'object') return null;
  if (node.indexName) return node.indexName;
  for (const value of Object.values(node)) {
    const found = findIndexName(value);
    if (found) return found;
  }
  return null;
}

async function explain(label, cursorPromise) {
  const explainResult = await cursorPromise.explain('queryPlanner');
  const plan = explainResult.queryPlanner.winningPlan;
  const index = findIndexName(plan) || '(none)';
  console.log(`${label} | INDEX: ${index} | COLLSCAN: ${hasCollscan(plan) ? 'YES' : 'NO'}`);
}

(async () => {
  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  await Student.syncIndexes();
  await Reservation.syncIndexes();
  await IdempotencyKey.syncIndexes();
  await MealSettings.syncIndexes();

  const student = await Student.create({
    name: 'Index Audit Student',
    roll_number: 'IDX1001',
    department: 'CSE',
    email: 'idx1001@test.local',
    password: 'hash-placeholder',
    reservationDeviceTokenHash: 'abc123',
    reservationDeviceBoundAt: new Date(),
    reservationDeviceLastUsedAt: new Date(),
  });
  await Reservation.create({ student_id: student._id, roll_number: 'IDX1001', reservation_date: '2026-12-01', breakfast: true });
  await IdempotencyKey.findOneAndUpdate(
    { key: 'op-index-audit' },
    { $setOnInsert: { key: 'op-index-audit', response: { ok: true }, statusCode: 200 } },
    { upsert: true, returnDocument: 'after' }
  );
  await MealSettings.create({ date: '2026-12-01' });

  await explain('reserve upsert student+date', Reservation.collection.find({ roll_number: 'IDX1001', reservation_date: '2026-12-01' }));
  await explain('count date+breakfast', Reservation.collection.find({ reservation_date: '2026-12-01', breakfast: true }));
  await explain('count date+lunch', Reservation.collection.find({ reservation_date: '2026-12-01', lunch: true }));
  await explain('count date+dinner', Reservation.collection.find({ reservation_date: '2026-12-01', dinner: true }));
  await explain('idempotency operationId', IdempotencyKey.collection.find({ key: 'op-index-audit' }));
  await explain('device binding by student _id', Student.collection.find({ _id: student._id }));
  await explain('student roll lookup', Student.collection.find({ roll_number: 'IDX1001' }));
  await explain('reservation schedule date', MealSettings.collection.find({ date: '2026-12-01' }));

  await mongoose.disconnect();
  await mongod.stop();
})().catch(async (err) => {
  console.error('Index explain audit failed:', err.message);
  try { await mongoose.disconnect(); } catch (e) {}
  process.exit(1);
});
