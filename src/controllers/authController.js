const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Student = require('../models/Student');
const Supervisor = require('../models/Supervisor');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_mess_token_123!';

// Register Student
const studentRegister = async (req, res) => {
  console.log("Registration Request Received");
  const { name, roll_number, department, hostel_block, room_number, mobile_number, email, password } = req.body;

  if (!name || !roll_number || !department || !email || !password) {
    return res.status(400).json({ error: 'Required fields are missing.' });
  }

  try {
    const existingRoll = await Student.findOne({ roll_number });
    if (existingRoll) {
      return res.status(400).json({ error: 'Roll Number already exists' });
    }

    const existingEmail = await Student.findOne({ email });
    if (existingEmail) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const student = await Student.create({
      name,
      roll_number,
      department,
      hostel_block: hostel_block || 'A',
      room_number: room_number || '101',
      phone: mobile_number || '',
      email,
      password: passwordHash,
      status: 'active'
    });

    res.status(201).json({ success: true, message: 'Student registered successfully', studentId: student._id });
    console.log("Student Registered Successfully");
  } catch (error) {
    console.error("Mongo Error Details:", error);
    res.status(500).json({ error: error.message || 'Database error during registration' });
  }
};

// Register Supervisor
const supervisorRegister = async (req, res) => {
  console.log("Supervisor Registration Request Received");
  const { name, employee_id, department, mobile_number, email, password } = req.body;

  if (!name || !employee_id || !email || !password) {
    return res.status(400).json({ error: 'Required fields are missing.' });
  }

  try {
    const existingId = await Supervisor.findOne({ supervisor_id: employee_id });
    if (existingId) {
      return res.status(400).json({ error: 'Employee ID already exists' });
    }

    const existingEmail = await Supervisor.findOne({ email });
    if (existingEmail) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const supervisor = await Supervisor.create({
      name,
      supervisor_id: employee_id,
      phone: mobile_number || '',
      email,
      password: passwordHash,
      role: 'admin'
    });

    res.status(201).json({ success: true, message: 'Supervisor registered successfully', supervisorId: supervisor._id });
    console.log("Supervisor Registered Successfully");
  } catch (error) {
    console.error("Mongo Error Details:", error);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

// Student Login
const studentLogin = async (req, res) => {
  const identifier = req.body.email || req.body.roll_number || req.body.username;
  const password = req.body.password;

  if (!identifier || !password) {
    return res.status(400).json({ error: 'Email/Roll Number and password are required' });
  }

  try {
    // 1. First check supervisor collection
    const supervisor = await Supervisor.findOne({
      $or: [{ supervisor_id: identifier }, { email: identifier }]
    });

    if (supervisor) {
      let isMatch = false;
      try {
        isMatch = await bcrypt.compare(password, supervisor.password);
      } catch (e) {
        isMatch = false;
      }
      if (!isMatch && password === supervisor.password) {
        isMatch = true;
      }

      if (isMatch) {
        const token = jwt.sign(
          { studentId: supervisor._id, rollNumber: supervisor.supervisor_id, role: 'admin', name: supervisor.name },
          JWT_SECRET,
          { expiresIn: '365d' }
        );
        console.log("Login Successful (Supervisor)");
        return res.status(200).json({
          token,
          user: {
            id: supervisor._id,
            name: supervisor.name,
            roll_number: supervisor.supervisor_id,
            department: 'Administration',
            email: supervisor.email,
            role: 'admin'
          }
        });
      }
    }

    // 2. Check student collection
    const student = await Student.findOne({
      $or: [{ email: identifier }, { roll_number: identifier }]
    });

    if (!student) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    let isMatch = false;
    try {
      isMatch = await bcrypt.compare(password, student.password);
    } catch (e) {
      isMatch = false;
    }

    if (!isMatch && password === student.password) {
      isMatch = true;
    }

    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid password' });
    }

    const token = jwt.sign(
      { studentId: student._id, rollNumber: student.roll_number, role: 'student', name: student.name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    console.log("Login Successful (Student)");

    res.status(200).json({
      token,
      user: {
        id: student._id,
        name: student.name,
        roll_number: student.roll_number,
        department: student.department,
        email: student.email,
        role: 'student'
      }
    });
  } catch (error) {
    console.error("Mongo Error Details:", error);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

// Supervisor Login
const supervisorLogin = async (req, res) => {
  const username = req.body.username || req.body.roll_number || req.body.employee_id || req.body.email || req.body.supervisor_id;
  const password = req.body.password;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username/Email and password are required' });
  }

  try {
    const supervisor = await Supervisor.findOne({
      $or: [{ supervisor_id: username }, { email: username }]
    });

    if (!supervisor) {
      return res.status(400).json({ error: 'Invalid username/email or password' });
    }

    let isMatch = (password === supervisor.password);
    if (!isMatch) {
      try {
        isMatch = await bcrypt.compare(password, supervisor.password);
      } catch (e) {
        isMatch = false;
      }
    }

    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid password' });
    }

    const token = jwt.sign(
      { studentId: supervisor._id, rollNumber: supervisor.supervisor_id, role: 'admin', name: supervisor.name },
      JWT_SECRET,
      { expiresIn: '365d' }
    );

    console.log("Login Successful");

    res.status(200).json({
      token,
      user: {
        id: supervisor._id,
        name: supervisor.name,
        roll_number: supervisor.supervisor_id,
        department: 'Administration',
        email: supervisor.email,
        role: 'admin'
      }
    });
  } catch (error) {
    console.error("Mongo Error Details:", error);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

const getMe = async (req, res) => {
  try {
    const student = await Student.findById(req.userId);
    if (!student) {
      const supervisor = await Supervisor.findById(req.userId);
      if (supervisor) {
        return res.status(200).json({
          id: supervisor._id,
          name: supervisor.name,
          roll_number: supervisor.supervisor_id,
          department: 'Administration',
          email: supervisor.email,
          role: 'admin'
        });
      }
      return res.status(404).json({ error: 'User not found' });
    }

    res.status(200).json({
      id: student._id,
      name: student.name,
      roll_number: student.roll_number,
      department: student.department,
      email: student.email,
      role: 'student'
    });
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

module.exports = {
  studentRegister,
  supervisorRegister,
  studentLogin,
  supervisorLogin,
  getMe
};
