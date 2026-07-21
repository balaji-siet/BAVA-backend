const db = require('../config/db');

// Helper to get simulated date string
function getSimulatedDateStr() {
  const now = new Date();
  const offsetHrs = parseInt(process.env.DEBUG_TIME_OFFSET_HRS || '0', 10);
  if (offsetHrs !== 0) {
    now.setHours(now.getHours() + offsetHrs);
  }
  return now.toISOString().split('T')[0];
}

// Auto-detect meal type based on current time (hours)
function detectMealType() {
  const now = new Date();
  const offsetHrs = parseInt(process.env.DEBUG_TIME_OFFSET_HRS || '0', 10);
  if (offsetHrs !== 0) {
    now.setHours(now.getHours() + offsetHrs);
  }
  const hour = now.getHours();
  // Breakfast: 6 AM - 10 AM
  // Lunch: 11 AM - 3 PM
  // Dinner: 6 PM - 10 PM
  if (hour >= 6 && hour < 11) {
    return 'breakfast';
  } else if (hour >= 11 && hour < 16) {
    return 'lunch';
  } else {
    return 'dinner';
  }
}

// POST /api/nfc/scan
const scanNfc = async (req, res) => {
  const deviceKey = req.headers['x-nfc-device-key'];
  const expectedSecret = process.env.NFC_DEVICE_SECRET || 'shakthi_nfc_hardware_device_secret_key_12345';
  
  if (deviceKey !== expectedSecret) {
    return res.status(403).json({ error: 'Access denied. Invalid NFC Device Key.' });
  }

  const { nfc_uid } = req.body;
  if (!nfc_uid) {
    return res.status(400).json({ error: 'nfc_uid is required' });
  }

  try {
    // 1. Fetch student details by NFC UID
    const [students] = await db.query(
      'SELECT id, name, roll_number, department, hostel_block FROM Students WHERE nfc_uid = ? LIMIT 1',
      [nfc_uid]
    );

    if (!students || students.length === 0) {
      return res.status(404).json({ error: 'Invalid NFC UID. Student not found.' });
    }

    const student = students[0];
    const today = getSimulatedDateStr();
    const mealType = detectMealType();
    const entryTime = new Date().toTimeString().split(' ')[0]; // HH:MM:SS

    // 2. Check if student already scanned for this meal today
    const [existing] = await db.query(
      'SELECT id FROM NfcAttendance WHERE student_id = ? AND date = ? AND meal_type = ? LIMIT 1',
      [student.id, today, mealType]
    );

    if (existing && existing.length > 0) {
      return res.status(400).json({ 
        error: 'Attendance already marked for this meal.',
        student_name: student.name,
        roll_number: student.roll_number
      });
    }

    // 3. Mark attendance in DB
    await db.query(
      'INSERT INTO NfcAttendance (student_id, student_name, roll_number, department, hostel_block, nfc_uid, meal_type, entry_time, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [student.id, student.name, student.roll_number, student.department, student.hostel_block, nfc_uid, mealType, entryTime, today]
    );

    // Award points for attendance and reservation compliance
    let pointsAwarded = 5;
    try {
      const [resCheck] = await db.query(
        "SELECT response FROM MealReservations WHERE student_id = ? AND date = ? AND meal_type = ? LIMIT 1",
        [student.id, today, mealType]
      );
      if (resCheck && resCheck.length > 0 && resCheck[0].response === 'Yes') {
        pointsAwarded = 10;
      }
      await db.query(
        'UPDATE Students SET points = points + ? WHERE id = ?',
        [pointsAwarded, student.id]
      );
    } catch (ptsErr) {
      console.error('Error awarding points:', ptsErr);
    }

    // 4. Emit live Socket.IO update if configured
    const io = req.app.get('io');
    if (io) {
      io.emit('nfc:attendance_update', {
        student_name: student.name,
        roll_number: student.roll_number,
        department: student.department,
        hostel_block: student.hostel_block,
        meal_type: mealType,
        entry_time: entryTime,
        date: today
      });
    }

    res.status(200).json({
      success: true,
      student_name: student.name,
      roll_number: student.roll_number,
      entry_time: entryTime,
      meal_type: mealType
    });

  } catch (error) {
    console.error('NFC scan verification error:', error);
    res.status(500).json({ error: 'Database error processing NFC scan.' });
  }
};

// GET /api/nfc/attendance/me
const getStudentAttendance = async (req, res) => {
  const studentId = req.userId;
  const today = getSimulatedDateStr();

  try {
    // Today's stats
    const [todayRows] = await db.query(
      'SELECT entry_time, meal_type, status FROM NfcAttendance WHERE student_id = ? AND date = ? LIMIT 1',
      [studentId, today]
    );

    // History
    const [historyRows] = await db.query(
      'SELECT date, meal_type, entry_time, status FROM NfcAttendance WHERE student_id = ? ORDER BY date DESC, entry_time DESC LIMIT 30',
      [studentId]
    );

    // Total stats
    const [totalReservations] = await db.query(
      "SELECT COUNT(*) as count FROM MealReservations WHERE student_id = ? AND response = 'Yes'",
      [studentId]
    );

    const [totalAttendance] = await db.query(
      'SELECT COUNT(*) as count FROM NfcAttendance WHERE student_id = ?',
      [studentId]
    );

    const reservedCount = totalReservations[0]?.count || 0;
    const attendedCount = totalAttendance[0]?.count || 0;
    const attendancePercentage = reservedCount > 0 ? Math.round((attendedCount / reservedCount) * 100) : 100;

    res.status(200).json({
      today_status: todayRows && todayRows.length > 0 ? 'Present' : 'Absent',
      entry_time: todayRows && todayRows.length > 0 ? todayRows[0].entry_time : null,
      meal_type: todayRows && todayRows.length > 0 ? todayRows[0].meal_type : null,
      history: historyRows || [],
      attendance_percentage: attendancePercentage
    });

  } catch (error) {
    console.error('Fetch student attendance error:', error);
    res.status(500).json({ error: 'Database error fetching attendance.' });
  }
};

// GET /api/nfc/attendance/student/:rollNumber
const getStudentAttendanceByRollNumber = async (req, res) => {
  const { rollNumber } = req.params;
  const today = getSimulatedDateStr();

  try {
    const [studentRows] = await db.query(
      'SELECT id, name FROM Students WHERE roll_number = ? LIMIT 1',
      [rollNumber]
    );

    if (!studentRows || studentRows.length === 0) {
      return res.status(404).json({ error: 'Student with this roll number not found.' });
    }

    const studentId = studentRows[0].id;
    const studentName = studentRows[0].name;

    // Today's stats
    const [todayRows] = await db.query(
      'SELECT entry_time, meal_type, status FROM NfcAttendance WHERE student_id = ? AND date = ? LIMIT 1',
      [studentId, today]
    );

    // History
    const [historyRows] = await db.query(
      'SELECT date, meal_type, entry_time, status FROM NfcAttendance WHERE student_id = ? ORDER BY date DESC, entry_time DESC LIMIT 30',
      [studentId]
    );

    // Total stats
    const [totalReservations] = await db.query(
      "SELECT COUNT(*) as count FROM MealReservations WHERE student_id = ? AND response = 'Yes'",
      [studentId]
    );

    const [totalAttendance] = await db.query(
      'SELECT COUNT(*) as count FROM NfcAttendance WHERE student_id = ?',
      [studentId]
    );

    const reservedCount = totalReservations[0]?.count || 0;
    const attendedCount = totalAttendance[0]?.count || 0;
    const attendancePercentage = reservedCount > 0 ? Math.round((attendedCount / reservedCount) * 100) : 100;

    res.status(200).json({
      student_name: studentName,
      today_status: todayRows && todayRows.length > 0 ? 'Present' : 'Absent',
      entry_time: todayRows && todayRows.length > 0 ? todayRows[0].entry_time : null,
      meal_type: todayRows && todayRows.length > 0 ? todayRows[0].meal_type : null,
      history: historyRows || [],
      attendance_percentage: attendancePercentage
    });

  } catch (error) {
    console.error('Fetch student attendance by roll error:', error);
    res.status(500).json({ error: 'Database error fetching attendance.' });
  }
};

// GET /api/nfc/attendance/today
const getTodayNfcAttendance = async (req, res) => {
  const today = req.query.date || getSimulatedDateStr();

  try {
    const [totalStudents] = await db.query('SELECT COUNT(*) as count FROM Students');
    const [totalReserved] = await db.query(
      "SELECT COUNT(*) as count FROM MealReservations WHERE date = ? AND response = 'Yes'",
      [today]
    );
    const [totalAttended] = await db.query(
      'SELECT COUNT(*) as count FROM NfcAttendance WHERE date = ?',
      [today]
    );

    const studentsCount = totalStudents[0]?.count || 0;
    const reservedCount = totalReserved[0]?.count || 0;
    const attendedCount = totalAttended[0]?.count || 0;
    const notAttendedCount = Math.max(0, reservedCount - attendedCount);
    const attendancePercentage = reservedCount > 0 ? Math.round((attendedCount / reservedCount) * 100) : 0;

    res.status(200).json({
      total_students: studentsCount,
      total_reserved: reservedCount,
      actual_attendance: attendedCount,
      not_attended: notAttendedCount,
      attendance_percentage: attendancePercentage
    });
  } catch (error) {
    console.error('Fetch today dashboard stats error:', error);
    res.status(500).json({ error: 'Database error fetching dashboard stats.' });
  }
};

// GET /api/nfc/non-attending
const getNonAttendingStudents = async (req, res) => {
  const date = req.query.date || getSimulatedDateStr();
  const mealType = req.query.meal_type || 'lunch';

  try {
    // Students who reserved Yes, but are not in NfcAttendance for that date & meal
    const [rows] = await db.query(
      `SELECT s.name as student_name, s.roll_number, s.department, s.hostel_block 
       FROM Students s
       JOIN MealReservations r ON s.id = r.student_id
       WHERE r.date = ? AND r.meal_type = ? AND r.response = 'Yes'
       AND s.id NOT IN (
         SELECT student_id FROM NfcAttendance WHERE date = ? AND meal_type = ?
       )`,
      [date, mealType, date, mealType]
    );

    res.status(200).json(rows || []);
  } catch (error) {
    console.error('Fetch non-attending students error:', error);
    res.status(500).json({ error: 'Database error fetching non-attending list.' });
  }
};

// GET /api/nfc/reports
const getAttendanceReports = async (req, res) => {
  const mode = req.query.mode || 'daily'; // daily, weekly, monthly
  const today = getSimulatedDateStr();

  try {
    let queryStr = '';
    let params = [];

    if (mode === 'daily') {
      // Return counts for today
      const [total] = await db.query('SELECT COUNT(*) as count FROM Students');
      const [present] = await db.query('SELECT COUNT(*) as count FROM NfcAttendance WHERE date = ?', [today]);
      const [reserved] = await db.query("SELECT COUNT(*) as count FROM MealReservations WHERE date = ? AND response = 'Yes'", [today]);
      
      const totalCount = total[0]?.count || 0;
      const presentCount = present[0]?.count || 0;
      const reservedCount = reserved[0]?.count || 0;
      const absentCount = Math.max(0, reservedCount - presentCount);
      const percentage = reservedCount > 0 ? Math.round((presentCount / reservedCount) * 100) : 0;

      return res.status(200).json({
        total_students: totalCount,
        present_students: presentCount,
        absent_students: absentCount,
        attendance_percentage: percentage
      });
    }

    // Weekly/Monthly trend summaries
    const limit = mode === 'weekly' ? 7 : 30;
    const [rows] = await db.query(
      `SELECT date, COUNT(*) as present_count 
       FROM NfcAttendance 
       GROUP BY date 
       ORDER BY date DESC 
       LIMIT ?`,
      [limit]
    );

    res.status(200).json(rows || []);
  } catch (error) {
    console.error('Fetch attendance reports error:', error);
    res.status(500).json({ error: 'Database error generating reports.' });
  }
};

// GET /api/nfc/waste-analytics
const getWasteAnalytics = async (req, res) => {
  const today = getSimulatedDateStr();
  try {
    const [reservedRows] = await db.query(
      "SELECT COUNT(*) as count FROM MealReservations WHERE date = ? AND response = 'Yes'",
      [today]
    );
    const [actualRows] = await db.query(
      "SELECT COUNT(*) as count FROM NfcAttendance WHERE date = ?",
      [today]
    );

    const reserved = reservedRows[0]?.count || 0;
    const actual = actualRows[0]?.count || 0;
    const missed = Math.max(0, reserved - actual);
    const wastePercent = reserved > 0 ? Math.round((missed / reserved) * 100) : 0;
    const accuracy = reserved > 0 ? Math.round((actual / reserved) * 100) : 100;

    res.status(200).json({
      food_waste_percentage: wastePercent,
      missed_meals: missed,
      attendance_accuracy: accuracy,
      reserved_count: reserved,
      actual_attendance: actual
    });
  } catch (error) {
    console.error('Fetch waste analytics error:', error);
    res.status(500).json({ error: 'Database error fetching waste stats.' });
  }
};

// GET /api/nfc/dashboard-analytics
const getDashboardAnalytics = async (req, res) => {
  try {
    // 1. Attendance trend (last 7 days)
    const [trendRows] = await db.query(
      `SELECT date, COUNT(*) as count FROM NfcAttendance GROUP BY date ORDER BY date DESC LIMIT 7`
    );

    // 2. Reservation vs Actual (last 7 days)
    const [resVsActualRows] = await db.query(
      `SELECT r.date, 
              SUM(CASE WHEN r.response = 'Yes' THEN 1 ELSE 0 END) as reserved,
              (SELECT COUNT(*) FROM NfcAttendance a WHERE a.date = r.date) as actual
       FROM MealReservations r
       GROUP BY r.date
       ORDER BY r.date DESC
       LIMIT 7`
    );

    // 3. Meal-wise attendance
    const [mealRows] = await db.query(
      `SELECT meal_type, COUNT(*) as count FROM NfcAttendance GROUP BY meal_type`
    );

    res.status(200).json({
      attendance_trend: trendRows || [],
      reservation_vs_actual: resVsActualRows || [],
      meal_wise: mealRows || []
    });
  } catch (error) {
    console.error('Fetch dashboard analytics error:', error);
    res.status(500).json({ error: 'Database error fetching dashboard charts.' });
  }
};

// GET /api/nfc/reports/export
const exportReport = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT date, student_name, roll_number, department, hostel_block, meal_type, entry_time FROM NfcAttendance ORDER BY date DESC`
    );

    let csvContent = 'Date,Student Name,Roll Number,Department,Hostel Block,Meal Type,Entry Time\n';
    if (rows) {
      rows.forEach(r => {
        csvContent += `"${r.date}","${r.student_name}","${r.roll_number}","${r.department}","${r.hostel_block}","${r.meal_type}","${r.entry_time}"\n`;
      });
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="mess_attendance_report.csv"');
    res.status(200).send(csvContent);
  } catch (error) {
    console.error('Export report error:', error);
    res.status(500).json({ error: 'Database error generating export.' });
  }
};

module.exports = {
  scanNfc,
  getStudentAttendance,
  getStudentAttendanceByRollNumber,
  getTodayNfcAttendance,
  getNonAttendingStudents,
  getAttendanceReports,
  getWasteAnalytics,
  getDashboardAnalytics,
  exportReport
};
