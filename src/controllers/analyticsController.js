const Student = require('../models/Student');
const Reservation = require('../models/Reservation');
const Attendance = require('../models/Attendance');

// GET /api/dashboard
const getDashboardAnalytics = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    // 1. Total Active Students
    const totalStudents = await Student.countDocuments({ status: 'active' });

    // 2. Breakfast, Lunch, Dinner reservations for today
    const reservationsToday = await Reservation.find({ reservation_date: today });
    let breakfastReservations = 0;
    let lunchReservations = 0;
    let dinnerReservations = 0;

    reservationsToday.forEach(r => {
      if (r.breakfast) breakfastReservations++;
      if (r.lunch) lunchReservations++;
      if (r.dinner) dinnerReservations++;
    });

    // 3. Daily Attendance (today)
    const dailyAttendance = await Attendance.countDocuments({ attendance_date: today, attendance_status: 'present' });

    // 4. Weekly Attendance (past 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const weeklyAttendance = await Attendance.countDocuments({
      attendance_date: { $gte: sevenDaysAgo },
      attendance_status: 'present'
    });

    // 5. Monthly Attendance (past 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const monthlyAttendance = await Attendance.countDocuments({
      attendance_date: { $gte: thirtyDaysAgo },
      attendance_status: 'present'
    });

    // 6. Participation Percentage
    const totalReservations = await Reservation.countDocuments();
    const totalAttendance = await Attendance.countDocuments({ attendance_status: 'present' });

    let participationPercentage = 100;
    if (totalReservations > 0) {
      participationPercentage = Math.round((totalAttendance / totalReservations) * 100);
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
    const students = await Student.find({ status: 'active' });
    const nonAttending = [];

    for (const student of students) {
      const reservedCount = await Reservation.countDocuments({
        $or: [{ student_id: student._id }, { roll_number: student.roll_number }]
      });
      const attendedCount = await Attendance.countDocuments({
        $or: [{ student_id: student._id }, { roll_number: student.roll_number }],
        attendance_status: 'present'
      });

      const missed = reservedCount > attendedCount ? (reservedCount - attendedCount) : 0;
      let attendancePercentage = 100;
      if (reservedCount > 0) {
        attendancePercentage = Math.round((attendedCount / reservedCount) * 100);
      }

      if (attendancePercentage < 85 || missed > 0) {
        nonAttending.push({
          id: student._id,
          name: student.name,
          roll_number: student.roll_number,
          hostel_block: student.hostel_block,
          department: student.department,
          email: student.email,
          mobile_number: student.phone || '',
          missed_meals: missed,
          attendance_percentage: attendancePercentage
        });
      }
    }

    res.status(200).json(nonAttending);
  } catch (error) {
    console.error('Fetch non attending students error:', error);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

// GET /api/leaderboard
const getLeaderboard = async (req, res) => {
  try {
    const topStudents = await Student.find({ status: 'active' })
      .select('name roll_number department hostel_block points')
      .sort({ points: -1 })
      .limit(10);

    res.status(200).json(topStudents);
  } catch (error) {
    console.error('Fetch leaderboard error:', error);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

// GET /api/forecast or /api/forecasts
const getForecast = async (req, res) => {
  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomStr = tomorrow.toISOString().split('T')[0];

    const today = new Date().toISOString().split('T')[0];
    const reservationsToday = await Reservation.find({ reservation_date: today });

    let bCount = 0;
    let lCount = 0;
    let dCount = 0;

    reservationsToday.forEach(r => {
      if (r.breakfast) bCount++;
      if (r.lunch) lCount++;
      if (r.dinner) dCount++;
    });

    const activeStudents = await Student.countDocuments({ status: 'active' });
    const baseline = Math.max(activeStudents, 50);

    const forecasts = [
      { date: tomStr, meal_type: 'breakfast', predicted_count: Math.max(bCount, Math.round(baseline * 0.75)) },
      { date: tomStr, meal_type: 'lunch', predicted_count: Math.max(lCount, Math.round(baseline * 0.85)) },
      { date: tomStr, meal_type: 'dinner', predicted_count: Math.max(dCount, Math.round(baseline * 0.80)) }
    ];

    res.status(200).json(forecasts);
  } catch (error) {
    console.error('Fetch forecast error:', error);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

// GET /api/students
const getStudentsList = async (req, res) => {
  try {
    const students = await Student.find({ status: 'active' }).select('-password');
    res.status(200).json(students);
  } catch (error) {
    console.error('Fetch students list error:', error);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

module.exports = {
  getDashboardAnalytics,
  getNonAttendingStudents,
  getLeaderboard,
  getForecast,
  getStudentsList
};

