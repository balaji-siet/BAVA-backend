const Reservation = require('../models/Reservation');
const Student = require('../models/Student');
const { validateStudentDeviceBinding } = require('./reservationDeviceController');

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

// Create or update meal reservations
const saveReservations = async (req, res) => {
  const studentId = req.userId;
  const date = req.body.date || req.body.reservation_date || new Date().toISOString().split('T')[0];
  const { breakfast, lunch, dinner, meal_type } = req.body;

  if (!date) {
    return res.status(400).json({ error: 'Date is required' });
  }

  try {
    const deviceOk = await validateStudentDeviceBinding(req, res);
    if (!deviceOk) return;

    let rollNumber = req.userRoll || req.body.roll_number;
    if (!rollNumber && studentId) {
      const student = await Student.findById(studentId).select('roll_number').lean();
      rollNumber = student ? student.roll_number : 'UNKNOWN';
    }
    rollNumber = rollNumber || 'UNKNOWN';

    let reservationDoc = await Reservation.findOne({
      $or: [
        { student_id: studentId, reservation_date: date },
        { roll_number: rollNumber, reservation_date: date }
      ]
    });

    if (!reservationDoc) {
      reservationDoc = new Reservation({
        student_id: studentId,
        roll_number: rollNumber,
        reservation_date: date,
        breakfast: false,
        lunch: false,
        dinner: false
      });
    }

    if (breakfast !== undefined) reservationDoc.breakfast = Boolean(breakfast);
    if (lunch !== undefined) reservationDoc.lunch = Boolean(lunch);
    if (dinner !== undefined) reservationDoc.dinner = Boolean(dinner);
    if (meal_type === 'breakfast') reservationDoc.breakfast = true;
    if (meal_type === 'lunch') reservationDoc.lunch = true;
    if (meal_type === 'dinner') reservationDoc.dinner = true;

    await reservationDoc.save();

    res.status(200).json({ message: 'Reservations saved successfully', reservation: reservationDoc });
    console.log("Reservation Saved");
  } catch (error) {
    if (error.code === 11000) {
      try {
        const rollNumber = req.userRoll || req.body.roll_number;
        const fallbackDoc = await Reservation.findOneAndUpdate(
          { roll_number: rollNumber, reservation_date: date },
          { $set: { breakfast: Boolean(breakfast), lunch: Boolean(lunch), dinner: Boolean(dinner) } },
          { new: true }
        );
        return res.status(200).json({ message: 'Reservations saved successfully', reservation: fallbackDoc });
      } catch (fallbackErr) {}
    }
    console.error("Mongo Error Details:", error);
    res.status(500).json({ error: 'Database error saving reservation' });
  }
};

// Cancel reservation endpoint
const cancelReservation = async (req, res) => {
  const studentId = req.userId;
  const { date, meal_type } = req.body;

  if (!date) {
    return res.status(400).json({ error: 'Date is required' });
  }

  try {
    const deviceOk = await validateStudentDeviceBinding(req, res);
    if (!deviceOk) return;

    let rollNumber = req.userRoll || req.body.roll_number;
    if (!rollNumber && studentId) {
      const student = await Student.findById(studentId).select('roll_number').lean();
      rollNumber = student ? student.roll_number : req.body.roll_number;
    }

    let reservationDoc = await Reservation.findOne({
      $or: [
        { student_id: studentId, reservation_date: date },
        { roll_number: rollNumber, reservation_date: date }
      ]
    });

    if (reservationDoc) {
      if (!meal_type) {
        reservationDoc.breakfast = false;
        reservationDoc.lunch = false;
        reservationDoc.dinner = false;
      } else {
        if (meal_type === 'breakfast') reservationDoc.breakfast = false;
        if (meal_type === 'lunch') reservationDoc.lunch = false;
        if (meal_type === 'dinner') reservationDoc.dinner = false;
      }
      await reservationDoc.save();
    }

    res.status(200).json({ message: 'Reservations cancelled successfully' });
  } catch (error) {
    console.error('Cancel reservations error:', error);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

// Get reservations for a specific date
const getReservationsByDate = async (req, res) => {
  const studentId = req.userId;
  const date = req.query.date || getCurrentTime().toISOString().split('T')[0];

  try {
    let rollNumber = req.userRoll || req.query.roll_number;
    if (!rollNumber && studentId) {
      const student = await Student.findById(studentId).select('roll_number').lean();
      rollNumber = student ? student.roll_number : req.query.roll_number;
    }

    const reservationDoc = await Reservation.findOne({
      $or: [
        { student_id: studentId, reservation_date: date },
        { roll_number: rollNumber, reservation_date: date }
      ]
    }).lean();

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
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

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
