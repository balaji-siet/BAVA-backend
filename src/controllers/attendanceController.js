const Attendance = require('../models/Attendance');
const Student = require('../models/Student');

// POST /api/attendance/mark
const markAttendance = async (req, res) => {
  const { student_id, roll_number, meal_type, attendance_date, attendance_status, verification_method } = req.body;

  if ((!student_id && !roll_number) || !meal_type || !attendance_date) {
    return res.status(400).json({ error: 'Student ID / Roll Number, Meal Type, and Date are required.' });
  }

  try {
    let student = null;
    if (student_id) {
      student = await Student.findById(student_id);
    }
    if (!student && roll_number) {
      student = await Student.findOne({ roll_number });
    }

    const rNumber = student ? student.roll_number : (roll_number || 'UNKNOWN');
    const statusVal = attendance_status || 'present';
    const methodVal = verification_method || 'nfc';

    const attendanceRecord = await Attendance.findOneAndUpdate(
      {
        $or: [
          { roll_number: rNumber, attendance_date, meal_type },
          { student_id: student ? student._id : student_id, attendance_date, meal_type }
        ]
      },
      {
        student_id: student ? student._id : student_id,
        roll_number: rNumber,
        meal_type,
        attendance_date,
        attendance_status: statusVal,
        verification_method: methodVal
      },
      { upsert: true, new: true }
    );

    res.status(200).json({ message: 'Attendance marked successfully', record: attendanceRecord });
    console.log("Attendance Saved");
  } catch (error) {
    console.error("Mongo Error Details:", error);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

// GET /api/attendance/student
const getStudentAttendance = async (req, res) => {
  const studentId = req.userId;

  try {
    let student = null;
    if (studentId) {
      student = await Student.findById(studentId);
    }
    const rollNumber = student ? student.roll_number : req.query.roll_number;

    const records = await Attendance.find({
      $or: [
        { student_id: studentId },
        { roll_number: rollNumber }
      ]
    }).sort({ attendance_date: -1 });

    res.status(200).json(records);
  } catch (error) {
    console.error('Get student attendance error:', error);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

// GET /api/attendance/all
const getAllAttendance = async (req, res) => {
  try {
    const records = await Attendance.find().sort({ attendance_date: -1 }).populate('student_id', 'name roll_number hostel_block department');

    const formatted = records.map(a => {
      const std = a.student_id || {};
      return {
        id: a._id,
        attendance_date: a.attendance_date,
        meal_type: a.meal_type,
        attendance_status: a.attendance_status,
        name: std.name || a.studentName || 'Student',
        roll_number: a.roll_number || std.roll_number || 'N/A',
        hostel_block: std.hostel_block || 'A',
        department: std.department || 'General'
      };
    });

    res.status(200).json(formatted);
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
