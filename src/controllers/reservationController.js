const Reservation = require('../models/Reservation');
const Student = require('../models/Student');
const IdempotencyKey = require('../models/IdempotencyKey');
const { validateStudentDeviceBinding, validateStudentMealPasswordIfProvided } = require('./reservationDeviceController');
const { getIndiaDateString, getIndiaTomorrowDateString } = require('../utils/dateUtils');
const { invalidateSettingsCache } = require('./mealSettingsController');
const { getBusinessNow, getMealWindowSnapshot, getReservationWindowStatus, MEALS } = require('../utils/reservationWindow');

// Helper to get time
function getCurrentTime() {
  return getBusinessNow();
}

// Check deadline constraints
async function isWindowOpen(mealType, dateStr, bypass = false) {
  if (bypass) return true;
  const status = await getReservationWindowStatus(mealType, dateStr);
  return status.allowed;
}

async function persistIdempotencyResponse(operationId, response, statusCode = 200) {
  if (!operationId) return;

  try {
    await IdempotencyKey.findOneAndUpdate(
      { key: operationId },
      { $setOnInsert: { key: operationId, response, statusCode } },
      { upsert: true, returnDocument: 'after' }
    ).lean();
  } catch (err) {
    if (err && err.code === 11000) {
      return;
    }
    throw err;
  }
}

function getRequestedMeals(body) {
  const requested = new Set();
  if (body.meal_type) requested.add(body.meal_type);
  for (const meal of MEALS) {
    if (body[meal] === true) requested.add(meal);
  }
  return [...requested].filter(meal => MEALS.includes(meal));
}

async function enforceReservationWindows(req, res, date) {
  if (req.query && (req.query.bypass === 'true' || req.query.bypass === true)) {
    return true;
  }
  const requestedMeals = getRequestedMeals(req.body);
  if (requestedMeals.length === 0) {
    res.status(400).json({ code: 'NO_MEAL_SELECTED', error: 'Select at least one meal to reserve.' });
    return false;
  }

  for (const meal of requestedMeals) {
    const status = await getReservationWindowStatus(meal, date);
    if (!status.allowed) {
      res.status(403).json({
        code: status.code,
        error: status.message,
        meal,
        date,
        window: {
          openDate: status.openDate || null,
          closeDate: status.closeDate || null,
          openTime: status.settings?.[meal]?.open_time || null,
          closeTime: status.settings?.[meal]?.close_time || null,
          boundary: 'cutoff_inclusive'
        }
      });
      return false;
    }
  }
  return true;
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
    const windowOk = await enforceReservationWindows(req, res, date);
    if (!windowOk) return;

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
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );

    invalidateSettingsCache();

    const responseData = { message: 'Reservations saved successfully', reservation: reservationDoc };

    await persistIdempotencyResponse(operationId, responseData, 200);

    return res.status(200).json(responseData);
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
      { returnDocument: 'after' }
    );

    invalidateSettingsCache();

    const responseData = { message: 'Reservations cancelled successfully', reservation: reservationDoc };

    await persistIdempotencyResponse(operationId, responseData, 200);

    return res.status(200).json(responseData);
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

    const MealSettings = require('../models/MealSettings');
    const settings = await MealSettings.findOne({ date }).lean();
    const windowDetails = settings ? getMealWindowSnapshot(settings, date, getCurrentTime()) : {
      breakfast: { open: false, status: 'UNAVAILABLE', code: 'SCHEDULE_NOT_AVAILABLE' },
      lunch: { open: false, status: 'UNAVAILABLE', code: 'SCHEDULE_NOT_AVAILABLE' },
      dinner: { open: false, status: 'UNAVAILABLE', code: 'SCHEDULE_NOT_AVAILABLE' }
    };
    const windows = {
      breakfast: windowDetails.breakfast.open,
      lunch: windowDetails.lunch.open,
      dinner: windowDetails.dinner.open
    };

    res.status(200).json({
      date,
      reservations,
      windows,
      windowDetails,
      settings,
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

const getDebugInfo = async (req, res) => {
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
      lunch: await isWindowOpen('lunch', dateStr),
      dinner: await isWindowOpen('dinner', dateStr)
    },
    windowsTomorrow: {
      date: tomorrowStr,
      breakfast: await isWindowOpen('breakfast', tomorrowStr)
    }
  });
};

module.exports = {
  saveReservations,
  getReservationsByDate,
  getReservationsHistory,
  getDebugInfo,
  cancelReservation,
  isWindowOpen
};
