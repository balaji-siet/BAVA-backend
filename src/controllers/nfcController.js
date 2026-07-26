const Student = require('../models/Student');
const Attendance = require('../models/Attendance');
const Reservation = require('../models/Reservation');

function getSimulatedDateStr() {
  const now = new Date();
  const offsetHrs = parseInt(process.env.DEBUG_TIME_OFFSET_HRS || '0', 10);
  if (offsetHrs !== 0) {
    now.setHours(now.getHours() + offsetHrs);
  }
  return now.toISOString().split('T')[0];
}

function detectMealType() {
  const now = new Date();
  const offsetHrs = parseInt(process.env.DEBUG_TIME_OFFSET_HRS || '0', 10);
  if (offsetHrs !== 0) {
    now.setHours(now.getHours() + offsetHrs);
  }
  const hour = now.getHours();
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

  const { nfc_uid, roll_number } = req.body;
  if (!nfc_uid && !roll_number) {
    return res.status(400).json({ error: 'nfc_uid or roll_number is required' });
  }

  try {
    let student = null;
    if (nfc_uid) {
      student = await Student.findOne({ nfc_card_id: nfc_uid });
    }
    if (!student && roll_number) {
      student = await Student.findOne({ roll_number });
    }

    if (!student) {
      return res.status(404).json({ error: 'Invalid NFC UID/Roll Number. Student not found.' });
    }

    const today = getSimulatedDateStr();
    const mealType = detectMealType();
    const entryTime = new Date().toTimeString().split(' ')[0];

    // Check if attendance already marked
    const existing = await Attendance.findOne({
      roll_number: student.roll_number,
      attendance_date: today,
      meal_type: mealType
    });

    if (existing) {
      return res.status(400).json({ 
        error: 'Attendance already marked for this meal.',
        student_name: student.name,
        roll_number: student.roll_number
      });
    }

    const attendanceRecord = await Attendance.create({
      student_id: student._id,
      roll_number: student.roll_number,
      meal_type: mealType,
      attendance_date: today,
      attendance_status: 'present',
      verification_method: 'nfc'
    });

    // Award points
    let pointsAwarded = 5;
    const resCheck = await Reservation.findOne({
      roll_number: student.roll_number,
      reservation_date: today
    });

    if (resCheck && resCheck[mealType]) {
      pointsAwarded = 10;
    }

    student.points = (student.points || 0) + pointsAwarded;
    await student.save();

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
      meal_type: mealType,
      recordId: attendanceRecord._id
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
    const student = await Student.findById(studentId);
    const rollNumber = student ? student.roll_number : req.query.roll_number;

    const todayAtt = await Attendance.findOne({
      $or: [{ student_id: studentId }, { roll_number: rollNumber }],
      attendance_date: today
    });

    const history = await Attendance.find({
      $or: [{ student_id: studentId }, { roll_number: rollNumber }]
    }).sort({ attendance_date: -1 }).limit(30);

    const totalReserved = await Reservation.countDocuments({
      $or: [{ student_id: studentId }, { roll_number: rollNumber }]
    });

    const totalAttended = await Attendance.countDocuments({
      $or: [{ student_id: studentId }, { roll_number: rollNumber }],
      attendance_status: 'present'
    });

    const percentage = totalReserved > 0 ? Math.round((totalAttended / totalReserved) * 100) : 100;

    res.status(200).json({
      today_status: todayAtt ? 'Present' : 'Absent',
      entry_time: todayAtt ? todayAtt.createdAt : null,
      meal_type: todayAtt ? todayAtt.meal_type : null,
      history: history.map(h => ({
        date: h.attendance_date,
        meal_type: h.meal_type,
        entry_time: h.createdAt,
        status: h.attendance_status
      })),
      attendance_percentage: percentage
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
    const student = await Student.findOne({ roll_number: rollNumber });

    const todayAtt = await Attendance.findOne({
      roll_number: rollNumber,
      attendance_date: today
    });

    const history = await Attendance.find({ roll_number: rollNumber })
      .sort({ attendance_date: -1 })
      .limit(30);

    const totalReserved = await Reservation.countDocuments({ roll_number: rollNumber });
    const totalAttended = await Attendance.countDocuments({ roll_number: rollNumber, attendance_status: 'present' });
    const percentage = totalReserved > 0 ? Math.round((totalAttended / totalReserved) * 100) : 100;

    res.status(200).json({
      student_name: student ? student.name : 'Student',
      today_status: todayAtt ? 'Present' : 'Absent',
      entry_time: todayAtt ? todayAtt.createdAt : null,
      meal_type: todayAtt ? todayAtt.meal_type : null,
      history: history.map(h => ({
        date: h.attendance_date,
        meal_type: h.meal_type,
        entry_time: h.createdAt,
        status: h.attendance_status
      })),
      attendance_percentage: percentage
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
    const studentsCount = await Student.countDocuments({ status: 'active' });
    const reservedCount = await Reservation.countDocuments({ reservation_date: today });
    const attendedCount = await Attendance.countDocuments({ attendance_date: today, attendance_status: 'present' });
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
    const reservations = await Reservation.find({ reservation_date: date, [mealType]: true });
    const attended = await Attendance.find({ attendance_date: date, meal_type: mealType });
    const attendedRolls = new Set(attended.map(a => a.roll_number));

    const nonAttending = [];
    for (const r of reservations) {
      if (!attendedRolls.has(r.roll_number)) {
        const std = await Student.findOne({ roll_number: r.roll_number });
        nonAttending.push({
          student_name: std ? std.name : 'Student',
          roll_number: r.roll_number,
          department: std ? std.department : 'N/A',
          hostel_block: std ? std.hostel_block : 'A'
        });
      }
    }

    res.status(200).json(nonAttending);
  } catch (error) {
    console.error('Fetch non-attending students error:', error);
    res.status(500).json({ error: 'Database error fetching non-attending list.' });
  }
};

// GET /api/nfc/reports
const getAttendanceReports = async (req, res) => {
  const mode = req.query.mode || 'daily';
  const today = getSimulatedDateStr();

  try {
    if (mode === 'daily') {
      const totalCount = await Student.countDocuments({ status: 'active' });
      const presentCount = await Attendance.countDocuments({ attendance_date: today, attendance_status: 'present' });
      const reservedCount = await Reservation.countDocuments({ reservation_date: today });
      const absentCount = Math.max(0, reservedCount - presentCount);
      const percentage = reservedCount > 0 ? Math.round((presentCount / reservedCount) * 100) : 0;

      return res.status(200).json({
        total_students: totalCount,
        present_students: presentCount,
        absent_students: absentCount,
        attendance_percentage: percentage
      });
    }

    const reports = await Attendance.aggregate([
      { $match: { attendance_status: 'present' } },
      { $group: { _id: '$attendance_date', present_count: { $sum: 1 } } },
      { $sort: { _id: -1 } },
      { $limit: mode === 'weekly' ? 7 : 30 }
    ]);

    const formatted = reports.map(r => ({
      date: r._id,
      present_count: r.present_count
    }));

    res.status(200).json(formatted);
  } catch (error) {
    console.error('Fetch attendance reports error:', error);
    res.status(500).json({ error: 'Database error generating reports.' });
  }
};

// GET /api/nfc/waste-analytics
const getWasteAnalytics = async (req, res) => {
  const today = getSimulatedDateStr();
  try {
    const reserved = await Reservation.countDocuments({ reservation_date: today });
    const actual = await Attendance.countDocuments({ attendance_date: today, attendance_status: 'present' });
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
    const trend = await Attendance.aggregate([
      { $match: { attendance_status: 'present' } },
      { $group: { _id: '$attendance_date', count: { $sum: 1 } } },
      { $sort: { _id: -1 } },
      { $limit: 7 }
    ]);

    const mealWise = await Attendance.aggregate([
      { $group: { _id: '$meal_type', count: { $sum: 1 } } }
    ]);

    res.status(200).json({
      attendance_trend: trend.map(t => ({ date: t._id, count: t.count })),
      reservation_vs_actual: [],
      meal_wise: mealWise.map(m => ({ meal_type: m._id, count: m.count }))
    });
  } catch (error) {
    console.error('Fetch dashboard analytics error:', error);
    res.status(500).json({ error: 'Database error fetching dashboard charts.' });
  }
};

// GET /api/nfc/reports/export
const exportReport = async (req, res) => {
  try {
    const attendance = await Attendance.find().sort({ attendance_date: -1 }).populate('student_id', 'name roll_number department hostel_block');

    let csvContent = 'Date,Student Name,Roll Number,Department,Hostel Block,Meal Type,Entry Time\n';
    attendance.forEach(a => {
      const std = a.student_id || {};
      const name = std.name || a.roll_number || 'Student';
      const roll = a.roll_number || std.roll_number || 'N/A';
      const dept = std.department || 'General';
      const block = std.hostel_block || 'A';
      csvContent += `"${a.attendance_date}","${name}","${roll}","${dept}","${block}","${a.meal_type}","${a.createdAt}"\n`;
    });

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
