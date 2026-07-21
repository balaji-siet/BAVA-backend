const db = require('../config/db');

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
    // Breakfast reservations open from 6:00 PM to 10:00 PM previous day
    return diffDays === 1 && currentHour >= 18 && currentHour < 22;
  } else if (mealType === 'lunch') {
    // Lunch reservations open from 6:00 AM to 10:00 AM same day
    return diffDays === 0 && currentHour >= 6 && currentHour < 10;
  } else if (mealType === 'dinner') {
    // Dinner reservations open from 12:00 PM to 4:00 PM same day
    return diffDays === 0 && currentHour >= 12 && currentHour < 16;
  }

  return false;
}

// Create or update meal reservations
const saveReservations = async (req, res) => {
  const studentId = req.userId;
  const { date, breakfast, lunch, dinner } = req.body;
  const bypass = req.headers['x-bypass-windows'] === process.env.ADMIN_SECRET || process.env.DEBUG_BYPASS === 'true';

  if (!date) {
    return res.status(400).json({ error: 'Date is required' });
  }

  const submissions = [];
  if (breakfast !== undefined) submissions.push({ type: 'breakfast', value: breakfast });
  if (lunch !== undefined) submissions.push({ type: 'lunch', value: lunch });
  if (dinner !== undefined) submissions.push({ type: 'dinner', value: dinner });

  if (submissions.length === 0) {
    return res.status(400).json({ error: 'No meal selections provided' });
  }

  try {
    // Fetch student's existing reservations for this date
    const [existingRows] = await db.query(
      'SELECT meal_type, reservation_status FROM meal_reservations WHERE student_id = ? AND reservation_date = ?',
      [studentId, date]
    );

    const existingMap = {};
    if (existingRows) {
      existingRows.forEach(row => {
        existingMap[row.meal_type] = row.reservation_status;
      });
    }

    // Check deadlines for each changed reservation
    for (const meal of submissions) {
      const targetVal = meal.value ? 'confirmed' : 'cancelled';
      const prevVal = existingMap[meal.type] || 'cancelled';
      
      if (prevVal !== targetVal) {
        if (!isWindowOpen(meal.type, date, bypass)) {
          return res.status(400).json({
            error: `Reservation window for ${meal.type} on ${date} is closed.`,
            mealType: meal.type
          });
        }
      }
    }

    // Save reservations
    for (const meal of submissions) {
      const targetVal = meal.value ? 'confirmed' : 'cancelled';
      const prevVal = existingMap[meal.type];

      if (prevVal !== undefined) {
        await db.query(
          'UPDATE meal_reservations SET reservation_status = ? WHERE student_id = ? AND reservation_date = ? AND meal_type = ?',
          [targetVal, studentId, date, meal.type]
        );
      } else {
        await db.query(
          'INSERT INTO meal_reservations (student_id, reservation_date, meal_type, reservation_status) VALUES (?, ?, ?, ?)',
          [studentId, date, meal.type, targetVal]
        );
      }
    }

    res.status(200).json({ message: 'Reservations saved successfully' });
    console.log("Reservation Saved");
  } catch (error) {
    console.error("SQL Error Details:", error);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

// Cancel reservation endpoint
const cancelReservation = async (req, res) => {
  const studentId = req.userId;
  const { date, meal_type } = req.body;
  const bypass = req.headers['x-bypass-windows'] === process.env.ADMIN_SECRET || process.env.DEBUG_BYPASS === 'true';

  if (!date) {
    return res.status(400).json({ error: 'Date is required' });
  }

  const meals = meal_type ? [meal_type] : ['breakfast', 'lunch', 'dinner'];

  try {
    for (const m of meals) {
      if (!isWindowOpen(m, date, bypass)) {
        return res.status(400).json({ error: `Reservation window for ${m} is closed.` });
      }
    }

    for (const m of meals) {
      const [existing] = await db.query(
        'SELECT id FROM meal_reservations WHERE student_id = ? AND reservation_date = ? AND meal_type = ? LIMIT 1',
        [studentId, date, m]
      );

      if (existing && existing.length > 0) {
        await db.query(
          'UPDATE meal_reservations SET reservation_status = ? WHERE student_id = ? AND reservation_date = ? AND meal_type = ?',
          ['cancelled', studentId, date, m]
        );
      } else {
        await db.query(
          'INSERT INTO meal_reservations (student_id, reservation_date, meal_type, reservation_status) VALUES (?, ?, ?, ?)',
          [studentId, date, m, 'cancelled']
        );
      }
    }

    res.status(200).json({ message: 'Reservations cancelled successfully' });
  } catch (error) {
    console.error('Cancel reservations error:', error);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

// Get reservations for a specific date (used by frontend)
const getReservationsByDate = async (req, res) => {
  const studentId = req.userId;
  const date = req.query.date || getCurrentTime().toISOString().split('T')[0];

  try {
    const [rows] = await db.query(
      'SELECT meal_type, reservation_status FROM meal_reservations WHERE student_id = ? AND reservation_date = ?',
      [studentId, date]
    );

    const reservations = { breakfast: false, lunch: false, dinner: false };
    if (rows) {
      rows.forEach(row => {
        reservations[row.meal_type] = row.reservation_status === 'confirmed';
      });
    }

    const windows = {
      breakfast: isWindowOpen('breakfast', date, req.query.bypass === 'true'),
      lunch: isWindowOpen('lunch', date, req.query.bypass === 'true'),
      dinner: isWindowOpen('dinner', date, req.query.bypass === 'true')
    };

    res.status(200).json({
      date,
      reservations,
      windows,
      hasReserved: rows && rows.length > 0,
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
    const [rows] = await db.query(
      'SELECT reservation_date, meal_type, reservation_status, created_at FROM meal_reservations WHERE student_id = ? ORDER BY reservation_date DESC',
      [studentId]
    );

    res.status(200).json(rows);
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
