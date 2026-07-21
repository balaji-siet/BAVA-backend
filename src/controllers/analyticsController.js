const db = require('../config/db');

// GET /api/dashboard
const getDashboardAnalytics = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    // 1. Total Students
    const [studentCountRows] = await db.query('SELECT COUNT(*) as count FROM students WHERE status = "active"');
    const totalStudents = studentCountRows ? studentCountRows[0].count : 0;

    // 2. Breakfast, Lunch, Dinner reservations for today
    const [breakfastResRows] = await db.query(
      'SELECT COUNT(*) as count FROM meal_reservations WHERE reservation_date = ? AND meal_type = "breakfast" AND reservation_status = "confirmed"',
      [today]
    );
    const [lunchResRows] = await db.query(
      'SELECT COUNT(*) as count FROM meal_reservations WHERE reservation_date = ? AND meal_type = "lunch" AND reservation_status = "confirmed"',
      [today]
    );
    const [dinnerResRows] = await db.query(
      'SELECT COUNT(*) as count FROM meal_reservations WHERE reservation_date = ? AND meal_type = "dinner" AND reservation_status = "confirmed"',
      [today]
    );

    const breakfastReservations = breakfastResRows ? breakfastResRows[0].count : 0;
    const lunchReservations = lunchResRows ? lunchResRows[0].count : 0;
    const dinnerReservations = dinnerResRows ? dinnerResRows[0].count : 0;

    // 3. Daily Attendance (today)
    const [dailyAttRows] = await db.query(
      'SELECT COUNT(*) as count FROM attendance WHERE attendance_date = ? AND attendance_status = "present"',
      [today]
    );
    const dailyAttendance = dailyAttRows ? dailyAttRows[0].count : 0;

    // 4. Weekly Attendance (past 7 days)
    const [weeklyAttRows] = await db.query(
      "SELECT COUNT(*) as count FROM attendance WHERE attendance_date >= date('now', '-7 days') AND attendance_status = 'present'"
    ).catch(async () => {
      // Fallback for MySQL
      return db.query("SELECT COUNT(*) as count FROM attendance WHERE attendance_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) AND attendance_status = 'present'");
    });
    const weeklyAttendance = weeklyAttRows && weeklyAttRows[0] ? weeklyAttRows[0].count : 0;

    // 5. Monthly Attendance (past 30 days)
    const [monthlyAttRows] = await db.query(
      "SELECT COUNT(*) as count FROM attendance WHERE attendance_date >= date('now', '-30 days') AND attendance_status = 'present'"
    ).catch(async () => {
      // Fallback for MySQL
      return db.query("SELECT COUNT(*) as count FROM attendance WHERE attendance_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND attendance_status = 'present'");
    });
    const monthlyAttendance = monthlyAttRows && monthlyAttRows[0] ? monthlyAttRows[0].count : 0;

    // 6. Participation Percentage: Total Attendance / Total Reservations
    const [totalReservationsRows] = await db.query(
      'SELECT COUNT(*) as count FROM meal_reservations WHERE reservation_status = "confirmed"'
    );
    const [totalAttendanceRows] = await db.query(
      'SELECT COUNT(*) as count FROM attendance WHERE attendance_status = "present"'
    );

    const totalResCount = totalReservationsRows ? totalReservationsRows[0].count : 0;
    const totalAttCount = totalAttendanceRows ? totalAttendanceRows[0].count : 0;

    let participationPercentage = 100;
    if (totalResCount > 0) {
      participationPercentage = Math.round((totalAttCount / totalResCount) * 100);
    }

    res.status(200).json({
      totalStudents,
      breakfastReservations,
      lunchReservations,
      dinnerReservations,
      dailyAttendance,
      weeklyAttendance,
      monthlyAttendance,
      participationPercentage
    });
  } catch (error) {
    console.error('Fetch dashboard analytics error:', error);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

// GET /api/students/non-attending
const getNonAttendingStudents = async (req, res) => {
  try {
    // Return students who have missed meals (e.g. had a reservation but no attendance, or general low attendance)
    // For compliance with spec, we return students alongside their missed meal count and participation percentage.
    const [rows] = await db.query(
      `SELECT s.id, s.name, s.roll_number, s.hostel_block, s.department, s.email, s.mobile_number,
       (SELECT COUNT(*) FROM meal_reservations r WHERE r.student_id = s.id AND r.reservation_status = 'confirmed') as reserved_meals,
       (SELECT COUNT(*) FROM attendance a WHERE a.student_id = s.id AND a.attendance_status = 'present') as attended_meals
       FROM students s`
    );

    const nonAttending = rows.map(student => {
      const reserved = student.reserved_meals || 0;
      const attended = student.attended_meals || 0;
      const missed = reserved > attended ? (reserved - attended) : 0;
      
      let attendancePercentage = 100;
      if (reserved > 0) {
        attendancePercentage = Math.round((attended / reserved) * 100);
      }

      return {
        id: student.id,
        name: student.name,
        roll_number: student.roll_number,
        hostel_block: student.hostel_block,
        department: student.department,
        email: student.email,
        mobile_number: student.mobile_number,
        missed_meals: missed,
        attendance_percentage: attendancePercentage
      };
    }).filter(s => s.attendance_percentage < 85); // Filter for low attendance/missed meals (percentage < 85%)

    res.status(200).json(nonAttending);
  } catch (error) {
    console.error('Fetch non attending students error:', error);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

module.exports = {
  getDashboardAnalytics,
  getNonAttendingStudents
};
