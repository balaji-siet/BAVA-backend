const crypto = require('crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Student = require('../src/models/Student');
const Reservation = require('../src/models/Reservation');
const IdempotencyKey = require('../src/models/IdempotencyKey');
const { hashDeviceToken } = require('../src/controllers/reservationDeviceController');

async function profile() {
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri, { maxPoolSize: 100 });
  await Student.syncIndexes();
  await Reservation.syncIndexes();
  await IdempotencyKey.syncIndexes();

  const roll = 'PROFILE0001';
  const rawToken = 'token_' + roll;
  const std = await Student.create({
    name: 'Profile Student',
    roll_number: roll,
    department: 'CSE',
    email: 'profile@smartmess.test',
    password: 'pw',
    status: 'active',
    reservationDeviceTokenHash: hashDeviceToken(rawToken),
    reservationDeviceBoundAt: new Date()
  });

  const N = 100;
  console.log(`Profiling single sequential stages over ${N} iterations...`);

  // Stage 1: IdempotencyKey.findOne (lean)
  let t0 = Date.now();
  for (let i = 0; i < N; i++) {
    await IdempotencyKey.findOne({ key: `op_${i}` }).lean();
  }
  const idemFindMs = (Date.now() - t0) / N;

  // Stage 2: Student.findById (non-lean vs lean)
  t0 = Date.now();
  for (let i = 0; i < N; i++) {
    await Student.findById(std._id).select('+reservationDeviceTokenHash');
  }
  const studentFindDocMs = (Date.now() - t0) / N;

  t0 = Date.now();
  for (let i = 0; i < N; i++) {
    await Student.findById(std._id).select('+reservationDeviceTokenHash').lean();
  }
  const studentFindLeanMs = (Date.now() - t0) / N;

  // Stage 3: Student.updateOne
  t0 = Date.now();
  for (let i = 0; i < N; i++) {
    await Student.updateOne({ _id: std._id }, { $set: { reservationDeviceLastUsedAt: new Date() } });
  }
  const studentUpdateMs = (Date.now() - t0) / N;

  // Stage 4: Reservation.findOneAndUpdate
  t0 = Date.now();
  for (let i = 0; i < N; i++) {
    await Reservation.findOneAndUpdate(
      { roll_number: roll, reservation_date: `2026-09-${10 + (i % 20)}` },
      { $set: { student_id: std._id, roll_number: roll, breakfast: true } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
  const resUpsertMs = (Date.now() - t0) / N;

  // Stage 5: IdempotencyKey.create
  t0 = Date.now();
  for (let i = 0; i < N; i++) {
    await IdempotencyKey.create({ key: `create_op_${i}`, response: { ok: true } });
  }
  const idemCreateMs = (Date.now() - t0) / N;

  console.log('Results per operation:');
  console.log(`  Idempotency findOne: ${idemFindMs.toFixed(3)} ms`);
  console.log(`  Student findById (Full Doc): ${studentFindDocMs.toFixed(3)} ms`);
  console.log(`  Student findById (Lean): ${studentFindLeanMs.toFixed(3)} ms`);
  console.log(`  Student updateOne: ${studentUpdateMs.toFixed(3)} ms`);
  console.log(`  Reservation findOneAndUpdate: ${resUpsertMs.toFixed(3)} ms`);
  console.log(`  Idempotency create: ${idemCreateMs.toFixed(3)} ms`);

  await mongoose.disconnect();
  await mongod.stop();
}

profile().catch(console.error);
