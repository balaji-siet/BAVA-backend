const db = require('../config/db');

// POST /api/attendance/mark
const markAttendance = async (req, res) => {
  const { student_id, meal_type, attendance_date, attendance_status } = req.body;

  if (!student_id || !meal_type || !attendance_date) {
    return res.status(400).json({ error: 'Student ID, Meal Type, and Date are required.' });
  }

  try {
    // Check if duplicate entry exists
    const [existing] = await db.query(
      'SELECT id FROM attendance WHERE student_id = ? AND attendance_date = ? AND meal_type = ? LIMIT 1',
      [student_id, attendance_date, meal_type]
    );

    const statusVal = attendance_status || 'present';

    if (existing && existing.length > 0) {
      await db.query(
        'UPDATE attendance SET attendance_status = ? WHERE id = ?',
        [statusVal, existing[0].id]
      );
    } else {
      await db.query(
        'INSERT INTO attendance (student_id, meal_type, attendance_date, attendance_status) VALUES (?, ?, ?, ?)',
        [student_id, meal_type, attendance_date, statusVal]
      );
    }

    res.status(200).json({ message: 'Attendance marked successfully' });
    console.log("Attendance Saved");
  } catch (error) {
    console.error("SQL Error Details:", error);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

// GET /api/attendance/student
const getStudentAttendance = async (req, res) => {
  const studentId = req.userId;

  try {
    let rows;
    try {
      const [result] = await db.query(
        'SELECT attendance_date, meal_type, status AS attendance_status, created_at FROM attendance WHERE student_id = ? ORDER BY attendance_date DESC',
        [studentId]
      );
      rows = result;
    } catch (e) {
      const [result] = await db.query(
        'SELECT attendance_date, meal_type, attendance_status, created_at FROM attendance WHERE student_id = ? ORDER BY attendance_date DESC',
        [studentId]
      );
      rows = result;
    }
    res.status(200).json(rows);
  } catch (error) {
    console.error('Get student attendance error:', error);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

// GET /api/attendance/all
const getAllAttendance = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT a.id, a.attendance_date, a.meal_type, a.attendance_status, s.name, s.roll_number, s.hostel_block, s.department
       FROM attendance a
       JOIN students s ON a.student_id = s.id
       ORDER BY a.attendance_date DESC`
    );
    res.status(200).json(rows);
  } catch (error) {
    console.error('Get all attendance error:', error);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

module.exports = {
  markAttendance,
  getStudentAttendance,
  getAllAttendance
};
