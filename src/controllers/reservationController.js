const Reservation = require('../models/Reservation');
const Student = require('../models/Student');
const IdempotencyKey = require('../models/IdempotencyKey');
const { validateStudentDeviceBinding, validateStudentMealPasswordIfProvided } = require('./reservationDeviceController');
const { getIndiaDateString, getIndiaTomorrowDateString } = require('../utils/dateUtils');
const { invalidateSettingsCache } = require('./mealSettingsController');

// Helper to get time
function getCurrentTime() {
  const now = new Date();
  const offsetHrs = parseInt(process.env.DEBUG_TIME_OFFSET_HRS || '0', 10);
  if (offsetHrs !== 0) {
    now.setHours(now.getHours() + offsetHrs);
  }
  return now;
}

// Check deadline constraints
function isWindowOpen(mealType, dateStr, bypass = false) {
  if (bypass) return true;

  const now = getCurrentTime();
  const parts = dateStr.split('-');
  const mealDate = new Date(parts[0], parts[1] - 1, parts[2]);
  const nowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  const diffTime = mealDate.getTime() - nowDate.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
  const currentHour = now.getHours();

  if (mealType === 'breakfast') {
    return diffDays === 1 && currentHour >= 18 && currentHour < 22;
  } else if (mealType === 'lunch') {
    return diffDays === 0 && currentHour >= 6 && currentHour < 10;
  } else if (mealType === 'dinner') {
    return diffDays === 0 && currentHour >= 12 && currentHour < 16;
  }

  return false;
}

// Create or update meal reservations atomically with idempotency support
const saveReservations = async (req, res) => {
  const studentId = req.userId;
  const date = req.body.date || req.body.reservation_date || getIndiaDateString();
  const { breakfast, lunch, dinner, meal_type } = req.body;
  const operationId = req.headers['x-operation-id'] || req.headers['idempotency-key'] || req.body.operation_id;

  if (!date) {
    return res.status(400).json({ error: 'Date is required' });
  }

  // Check idempotency cache if operationId is supplied
  if (operationId) {
    try {
      const cached = await IdempotencyKey.findOne({ key: operationId }).lean();
      if (cached) {
        console.log(`[Idempotency] Returning cached response for key: ${operationId}`);
        return res.status(cached.statusCode || 200).json(cached.response);
      }
    } catch (idemCheckErr) {
      console.warn('[Idempotency] Check error:', idemCheckErr.message);
    }
  }

  try {
    const deviceOk = await validateStudentDeviceBinding(req, res);
    if (!deviceOk) return;
    const passwordOk = await validateStudentMealPasswordIfProvided(req, res);
    if (!passwordOk) return;

    let rollNumber = req.userRoll || req.body.roll_number;
    if (!rollNumber && studentId) {
      const student = await Student.findById(studentId).select('roll_number').lean();
      rollNumber = student ? student.roll_number : 'UNKNOWN';
    }
    rollNumber = rollNumber || 'UNKNOWN';

    // Build atomic update payload
    const updateFields = {};
    if (studentId) updateFields.student_id = studentId;
    if (rollNumber && rollNumber !== 'UNKNOWN') updateFields.roll_number = rollNumber;
    if (breakfast !== undefined) updateFields.breakfast = Boolean(breakfast);
    if (lunch !== undefined) updateFields.lunch = Boolean(lunch);
    if (dinner !== undefined) updateFields.dinner = Boolean(dinner);
    if (meal_type === 'breakfast') updateFields.breakfast = true;
    if (meal_type === 'lunch') updateFields.lunch = true;
    if (meal_type === 'dinner') updateFields.dinner = true;

    // Atomic findOneAndUpdate with upsert
    const reservationDoc = await Reservation.findOneAndUpdate(
      { roll_number: rollNumber, reservation_date: date },
      { $set: updateFields },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    invalidateSettingsCache();

    const responseData = { message: 'Reservations saved successfully', reservation: reservationDoc };

    if (operationId) {
      try {
        await IdempotencyKey.create({ key: operationId, response: responseData, statusCode: 200 });
      } catch (idemSaveErr) {
        // Ignore duplicate key if concurrently stored
      }
    }

    res.status(200).json(responseData);
    console.log(`[Reservation] Saved atomically for roll: ${rollNumber}, date: ${date}`);
  } catch (error) {
    console.error("Reservation Error Details:", error);
    res.status(500).json({ error: 'Database error saving reservation' });
  }
};

// Cancel reservation endpoint atomically
const cancelReservation = async (req, res) => {
  const studentId = req.userId;
  const { date, meal_type } = req.body;
  const operationId = req.headers['x-operation-id'] || req.headers['idempotency-key'] || req.body.operation_id;

  if (!date) {
    return res.status(400).json({ error: 'Date is required' });
  }

  // Check idempotency cache
  if (operationId) {
    try {
      const cached = await IdempotencyKey.findOne({ key: operationId }).lean();
      if (cached) {
        console.log(`[Idempotency] Returning cached response for cancel key: ${operationId}`);
        return res.status(cached.statusCode || 200).json(cached.response);
      }
    } catch (idemCheckErr) {
      console.warn('[Idempotency] Check error:', idemCheckErr.message);
    }
  }

  try {
    const deviceOk = await validateStudentDeviceBinding(req, res);
    if (!deviceOk) return;
    const passwordOk = await validateStudentMealPasswordIfProvided(req, res);
    if (!passwordOk) return;

    let rollNumber = req.userRoll || req.body.roll_number;
    if (!rollNumber && studentId) {
      const student = await Student.findById(studentId).select('roll_number').lean();
      rollNumber = student ? student.roll_number : req.body.roll_number;
    }
    rollNumber = rollNumber || 'UNKNOWN';

    const updateFields = {};
    if (!meal_type) {
      updateFields.breakfast = false;
      updateFields.lunch = false;
      updateFields.dinner = false;
    } else {
      if (meal_type === 'breakfast') updateFields.breakfast = false;
      if (meal_type === 'lunch') updateFields.lunch = false;
      if (meal_type === 'dinner') updateFields.dinner = false;
    }

    const reservationDoc = await Reservation.findOneAndUpdate(
      { roll_number: rollNumber, reservation_date: date },
      { $set: updateFields },
      { new: true }
    );

    invalidateSettingsCache();

    const responseData = { message: 'Reservations cancelled successfully', reservation: reservationDoc };

    if (operationId) {
      try {
        await IdempotencyKey.create({ key: operationId, response: responseData, statusCode: 200 });
      } catch (idemSaveErr) {}
    }

    res.status(200).json(responseData);
  } catch (error) {
    console.error('Cancel reservations error:', error);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

// Get reservations for a specific date
const getReservationsByDate = async (req, res) => {
  const studentId = req.userId;
  const date = req.query.date || getIndiaDateString(getCurrentTime());

  try {
    let rollNumber = req.userRoll || req.query.roll_number;
    if (!rollNumber && studentId) {
      const student = await Student.findById(studentId).select('roll_number').lean();
      rollNumber = student ? student.roll_number : req.query.roll_number;
    }

    const queryConditions = [];
    if (rollNumber) queryConditions.push({ roll_number: rollNumber, reservation_date: date });
    if (studentId) queryConditions.push({ student_id: studentId, reservation_date: date });

    const query = queryConditions.length > 0 ? { $or: queryConditions } : { reservation_date: date };

    const reservationDoc = await Reservation.findOne(query).lean();

    const reservations = {
      breakfast: reservationDoc ? reservationDoc.breakfast : false,
      lunch: reservationDoc ? reservationDoc.lunch : false,
      dinner: reservationDoc ? reservationDoc.dinner : false
    };

    const windows = {
      breakfast: isWindowOpen('breakfast', date, req.query.bypass === 'true'),
      lunch: isWindowOpen('lunch', date, req.query.bypass === 'true'),
      dinner: isWindowOpen('dinner', date, req.query.bypass === 'true')
    };

    res.status(200).json({
      date,
      reservations,
      windows,
      hasReserved: Boolean(reservationDoc),
      serverTime: getCurrentTime().toISOString()
    });
  } catch (error) {
    console.error('Fetch reservations by date error:', error);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

// Get complete history
const getReservationsHistory = async (req, res) => {
  const studentId = req.userId;

  try {
    let rollNumber = req.userRoll || req.query.roll_number;
    if (!rollNumber && studentId) {
      const student = await Student.findById(studentId).select('roll_number').lean();
      rollNumber = student ? student.roll_number : req.query.roll_number;
    }

    const queryConditions = [];
    if (studentId) queryConditions.push({ student_id: studentId });
    if (rollNumber) queryConditions.push({ roll_number: rollNumber });

    const query = queryConditions.length > 0 ? { $or: queryConditions } : {};

    const reservations = await Reservation.find(query).sort({ reservation_date: -1 }).lean();

    res.status(200).json(reservations);
  } catch (error) {
    console.error('Fetch reservations history error:', error);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

const getDebugInfo = (req, res) => {
  const now = getCurrentTime();
  const dateStr = now.toISOString().split('T')[0];
  
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = getIndiaTomorrowDateString(now);

  res.status(200).json({
    currentTime: now.toISOString(),
    localString: now.toLocaleString(),
    offsetHours: parseInt(process.env.DEBUG_TIME_OFFSET_HRS || '0', 10),
    windowsToday: {
      date: dateStr,
      lunch: isWindowOpen('lunch', dateStr),
      dinner: isWindowOpen('dinner', dateStr)
    },
    windowsTomorrow: {
      date: tomorrowStr,
      breakfast: isWindowOpen('breakfast', tomorrowStr)
    }
  });
};

module.exports = {
  saveReservations,
  getReservationsByDate,
  getReservationsHistory,
  getDebugInfo,
  cancelReservation
};
