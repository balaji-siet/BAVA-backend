const crypto = require('crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Student = require('../src/models/Student');
const Reservation = require('../src/models/Reservation');
const IdempotencyKey = require('../src/models/IdempotencyKey');
const { hashDeviceToken } = require('../src/controllers/reservationDeviceController');

// Helper to simulate express req/res
function mockReqRes(reqData, handler) {
  return new Promise((resolve) => {
    const req = {
      body: reqData.body || {},
      query: reqData.query || {},
      headers: reqData.headers || {},
      userId: reqData.userId,
      userRole: reqData.userRole || 'student',
      userRoll: reqData.userRoll,
      ip: reqData.ip || '127.0.0.1'
    };

    const res = {
      statusCode: 200,
      headersSent: false,
      _headers: {},
      setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
      getHeader(k) { return this._headers[k.toLowerCase()]; },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        resolve({ status: this.statusCode, data, headers: this._headers });
      },
      send(data) {
        resolve({ status: this.statusCode, data, headers: this._headers });
      }
    };

    handler(req, res).catch((err) => {
      resolve({ status: 500, data: { error: err.message }, headers: {} });
    });
  });
}

// Optimized handler for testing
async function optimizedSaveReservations(req, res) {
  const studentId = req.userId;
  const date = req.body.date || '2026-09-15';
  const { breakfast, lunch, dinner, meal_type } = req.body;
  const operationId = req.headers['x-operation-id'];

  if (operationId) {
    const cached = await IdempotencyKey.findOne({ key: operationId }).lean();
    if (cached) {
      return res.status(cached.statusCode || 200).json(cached.response);
    }
  }

  // Optimized Device Binding Check using lean
  const receivedToken = req.headers['x-smartmess-device-token'];
  if (!receivedToken) {
    return res.status(403).json({ error: 'Device token required' });
  }

  const student = await Student.findById(studentId).select('+reservationDeviceTokenHash').lean();
  if (!student || !student.reservationDeviceTokenHash) {
    return res.status(403).json({ error: 'Device binding required' });
  }

  const receivedHash = hashDeviceToken(receivedToken);
  const expected = Buffer.from(student.reservationDeviceTokenHash, 'hex');
  const actual = Buffer.from(receivedHash, 'hex');
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return res.status(403).json({ error: 'Invalid device token' });
  }

  // Non-blocking background touch of lastUsedAt
  Student.updateOne({ _id: studentId }, { $set: { reservationDeviceLastUsedAt: new Date() } }).catch(() => {});

  const rollNumber = req.userRoll || student.roll_number || 'UNKNOWN';
  const updateFields = {
    student_id: studentId,
    roll_number: rollNumber
  };
  if (breakfast !== undefined) updateFields.breakfast = Boolean(breakfast);
  if (lunch !== undefined) updateFields.lunch = Boolean(lunch);
  if (dinner !== undefined) updateFields.dinner = Boolean(dinner);
  if (meal_type === 'breakfast') updateFields.breakfast = true;

  const reservationDoc = await Reservation.findOneAndUpdate(
    { roll_number: rollNumber, reservation_date: date },
    { $set: updateFields },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );

  const responseData = { message: 'Reservations saved successfully', reservation: reservationDoc };

  if (operationId) {
    IdempotencyKey.create({ key: operationId, response: responseData, statusCode: 200 }).catch(() => {});
  }

  return res.status(200).json(responseData);
}

async function testBatches() {
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri, { maxPoolSize: 100, minPoolSize: 20 });
  await Student.syncIndexes();
  await Reservation.syncIndexes();
  await IdempotencyKey.syncIndexes();

  console.log('Seeding 1000 students...');
  const studentDocs = [];
  const rawTokens = {};
  for (let i = 1; i <= 1000; i++) {
    const roll = `LOADTEST${String(i).padStart(4, '0')}`;
    const rawToken = `device_token_${roll}_${crypto.randomBytes(8).toString('hex')}`;
    rawTokens[roll] = rawToken;

    studentDocs.push({
      name: `Test Student ${i}`,
      roll_number: roll,
      department: 'CSE',
      email: `${roll.toLowerCase()}@smartmess.test`,
      password: 'hashed_password_test',
      status: 'active',
      reservationDeviceTokenHash: hashDeviceToken(rawToken),
      reservationDeviceBoundAt: new Date(),
      reservationDeviceLastUsedAt: new Date()
    });
  }
  const createdStudents = await Student.insertMany(studentDocs);
  console.log('Seed complete. Running multi-stage concurrency tests:\n');

  const userCounts = [10, 50, 100, 250, 500, 1000];

  for (const count of userCounts) {
    const testStudents = createdStudents.slice(0, count);
    const dateStr = `2026-09-${count}`;
    const latencies = [];
    const t0 = Date.now();

    const promises = testStudents.map(std => {
      const roll = std.roll_number;
      const opId = `op_stage_${count}_${roll}`;
      const token = rawTokens[roll];
      const reqStart = Date.now();
      return mockReqRes({
        userId: std._id.toString(),
        userRoll: roll,
        headers: {
          'x-operation-id': opId,
          'x-smartmess-device-token': token
        },
        body: {
          date: dateStr,
          roll_number: roll,
          meal_type: 'breakfast',
          breakfast: true
        }
      }, optimizedSaveReservations).then(res => {
        const d = Date.now() - reqStart;
        latencies.push(d);
        return res;
      });
    });

    const results = await Promise.allSettled(promises);
    const totalMs = Date.now() - t0;

    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.50)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    const p99 = latencies[Math.floor(latencies.length * 0.99)];
    const max = latencies[latencies.length - 1];
    const avg = (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(1);
    const rps = ((count / totalMs) * 1000).toFixed(1);

    const successCount = results.filter(r => r.status === 'fulfilled' && (r.value.status === 200 || r.value.status === 201)).length;
    const dbCount = await Reservation.countDocuments({ reservation_date: dateStr, breakfast: true });

    console.log(`[STAGE: ${count} users]`);
    console.log(`  Requests: ${count}, Success: ${successCount}, DB Active: ${dbCount}`);
    console.log(`  Total time: ${totalMs} ms, Throughput: ${rps} req/sec`);
    console.log(`  Latencies: avg=${avg}ms, p50=${p50}ms, p95=${p95}ms, p99=${p99}ms, max=${max}ms\n`);
  }

  await mongoose.disconnect();
  await mongod.stop();
}

testBatches().catch(console.error);
