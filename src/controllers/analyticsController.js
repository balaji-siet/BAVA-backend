const Student = require('../models/Student');
const Reservation = require('../models/Reservation');
const Attendance = require('../models/Attendance');

// GET /api/dashboard
const getDashboardAnalytics = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    // 1. Total Active Students & Meal reservations for today (parallel countDocuments)
    const [
      totalStudents,
      breakfastReservations,
      lunchReservations,
      dinnerReservations,
      dailyAttendance
    ] = await Promise.all([
      Student.countDocuments({ status: 'active' }),
      Reservation.countDocuments({ reservation_date: today, breakfast: true }),
      Reservation.countDocuments({ reservation_date: today, lunch: true }),
      Reservation.countDocuments({ reservation_date: today, dinner: true }),
      Attendance.countDocuments({ attendance_date: today, attendance_status: 'present' })
    ]);

    // 2. Weekly Attendance (past 7 days) & Monthly Attendance (past 30 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const [
      weeklyAttendance,
      monthlyAttendance,
      totalReservations,
      totalAttendance
    ] = await Promise.all([
      Attendance.countDocuments({
        attendance_date: { $gte: sevenDaysAgo },
        attendance_status: 'present'
      }),
      Attendance.countDocuments({
        attendance_date: { $gte: thirtyDaysAgo },
        attendance_status: 'present'
      }),
      Reservation.countDocuments(),
      Attendance.countDocuments({ attendance_status: 'present' })
    ]);

    // 3. Participation Percentage
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

// GET /api/students/non-attending (Aggregated in single MongoDB query instead of N+1)
const getNonAttendingStudents = async (req, res) => {
  try {
    const results = await Student.aggregate([
      { $match: { status: 'active' } },
      {
        $lookup: {
          from: 'reservations',
          let: { sId: '$_id', sRoll: '$roll_number' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $or: [
                    { $eq: ['$student_id', '$$sId'] },
                    { $eq: ['$roll_number', '$$sRoll'] }
                  ]
                }
              }
            },
            { $count: 'total' }
          ],
          as: 'resCount'
        }
      },
      {
        $lookup: {
          from: 'attendances',
          let: { sId: '$_id', sRoll: '$roll_number' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$attendance_status', 'present'] },
                    {
                      $or: [
                        { $eq: ['$student_id', '$$sId'] },
                        { $eq: ['$roll_number', '$$sRoll'] }
                      ]
                    }
                  ]
                }
              }
            },
            { $count: 'total' }
          ],
          as: 'attCount'
        }
      },
      {
        $project: {
          id: '$_id',
          name: 1,
          roll_number: 1,
          hostel_block: 1,
          department: 1,
          email: 1,
          mobile_number: { $ifNull: ['$phone', ''] },
          reservedCount: { $ifNull: [{ $arrayElemAt: ['$resCount.total', 0] }, 0] },
          attendedCount: { $ifNull: [{ $arrayElemAt: ['$attCount.total', 0] }, 0] }
        }
      },
      {
        $addFields: {
          missed_meals: {
            $cond: [
              { $gt: ['$reservedCount', '$attendedCount'] },
              { $subtract: ['$reservedCount', '$attendedCount'] },
              0
            ]
          },
          attendance_percentage: {
            $cond: [
              { $gt: ['$reservedCount', 0] },
              { $round: [{ $multiply: [{ $divide: ['$attendedCount', '$reservedCount'] }, 100] }, 0] },
              100
            ]
          }
        }
      },
      {
        $match: {
          $or: [
            { attendance_percentage: { $lt: 85 } },
            { missed_meals: { $gt: 0 } }
          ]
        }
      }
    ]);

    res.status(200).json(results);
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
      .limit(10)
      .lean();

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

    const [bCount, lCount, dCount, activeStudents] = await Promise.all([
      Reservation.countDocuments({ reservation_date: today, breakfast: true }),
      Reservation.countDocuments({ reservation_date: today, lunch: true }),
      Reservation.countDocuments({ reservation_date: today, dinner: true }),
      Student.countDocuments({ status: 'active' })
    ]);

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

// GET /api/students (Supports search and pagination)
const getStudentsList = async (req, res) => {
  try {
    const { search, page, limit } = req.query;
    const query = { status: 'active' };

    if (search && typeof search === 'string' && search.trim()) {
      const regex = new RegExp(search.trim(), 'i');
      query.$or = [
        { name: regex },
        { roll_number: regex },
        { department: regex }
      ];
    }

    let studentsQuery = Student.find(query).select('-password');

    if (page && limit) {
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
      const skip = (pageNum - 1) * limitNum;
      studentsQuery = studentsQuery.skip(skip).limit(limitNum);
    }

    const students = await studentsQuery.lean();
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
