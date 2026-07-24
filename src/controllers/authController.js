const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_mess_token_123!';

// Register Student
const studentRegister = async (req, res) => {
  console.log("Registration Request Received");
  const { name, roll_number, department, hostel_block, mobile_number, email, password } = req.body;

  if (!name || !roll_number || !department || !email || !password) {
    return res.status(400).json({ error: 'Required fields are missing.' });
  }

  try {
    // Check if roll number already exists
    const [existingRoll] = await db.query(
      'SELECT id FROM students WHERE roll_number = ? LIMIT 1',
      [roll_number]
    );
    if (existingRoll && existingRoll.length > 0) {
      return res.status(400).json({ error: 'Roll Number already exists' });
    }

    // Check if email already exists
    const [existingEmail] = await db.query(
      'SELECT id FROM students WHERE email = ? LIMIT 1',
      [email]
    );
    if (existingEmail && existingEmail.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Insert student with fallback for optional status column
    try {
      await db.query(
        'INSERT INTO students (name, roll_number, department, hostel_block, mobile_number, email, password_hash, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [name, roll_number, department, hostel_block || null, mobile_number || null, email, passwordHash, 'active']
      );
    } catch (insertErr) {
      if (insertErr.code === 'ER_BAD_FIELD_ERROR' || (insertErr.message && insertErr.message.includes('status'))) {
        await db.query(
          'INSERT INTO students (name, roll_number, department, hostel_block, mobile_number, email, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [name, roll_number, department, hostel_block || null, mobile_number || null, email, passwordHash]
        );
      } else {
        throw insertErr;
      }
    }

    res.status(201).json({ success: true, message: 'Student registered successfully' });
    console.log("Student Registered Successfully");
  } catch (error) {
    console.error("SQL Error Details:", error);
    res.status(500).json({ error: error.message || 'Database error during registration' });
  }
};

// Register Supervisor
const supervisorRegister = async (req, res) => {
  console.log("Registration Request Received");
  const { name, employee_id, department, mobile_number, email, password } = req.body;

  if (!name || !employee_id || !email || !password) {
    return res.status(400).json({ error: 'Required fields are missing.' });
  }

  try {
    // Check if employee ID already exists
    const [existingId] = await db.query(
      'SELECT id FROM supervisors WHERE employee_id = ? LIMIT 1',
      [employee_id]
    );
    if (existingId && existingId.length > 0) {
      return res.status(400).json({ error: 'Employee ID already exists' });
    }

    // Check if email already exists
    const [existingEmail] = await db.query(
      'SELECT id FROM supervisors WHERE email = ? LIMIT 1',
      [email]
    );
    if (existingEmail && existingEmail.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Insert supervisor with fallback for optional role column
    try {
      await db.query(
        'INSERT INTO supervisors (name, employee_id, department, mobile_number, email, password_hash, role) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [name, employee_id, department || null, mobile_number || null, email, passwordHash, 'admin']
      );
    } catch (insertErr) {
      if (insertErr.code === 'ER_BAD_FIELD_ERROR' || (insertErr.message && insertErr.message.includes('role'))) {
        await db.query(
          'INSERT INTO supervisors (name, employee_id, department, mobile_number, email, password_hash) VALUES (?, ?, ?, ?, ?, ?)',
          [name, employee_id, department || null, mobile_number || null, email, passwordHash]
        );
      } else {
        throw insertErr;
      }
    }

    res.status(201).json({ success: true, message: 'Supervisor registered successfully' });
    console.log("Supervisor Registered Successfully");
  } catch (error) {
    console.error("SQL Error Details:", error);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

// Student Login — accepts { email, password } OR { roll_number, password } for frontend compatibility
const studentLogin = async (req, res) => {
  const identifier = req.body.email || req.body.roll_number || req.body.username;
  const password = req.body.password;

  if (!identifier || !password) {
    return res.status(400).json({ error: 'Email/Roll Number and password are required' });
  }

  try {
    const [supervisors] = await db.query(
      'SELECT * FROM supervisors WHERE employee_id = ? OR email = ? LIMIT 1',
      [identifier, identifier]
    );

    if (supervisors && supervisors.length > 0) {
      const supervisor = supervisors[0];
      let isMatch = (password === supervisor.password_hash);
      if (!isMatch) {
        try { isMatch = await bcrypt.compare(password, supervisor.password_hash); } catch (e) { isMatch = false; }
      }

      if (isMatch) {
        const token = jwt.sign(
          { studentId: 0, rollNumber: supervisor.employee_id, role: 'admin', name: supervisor.name },
          JWT_SECRET,
          { expiresIn: '365d' }
        );
        console.log("Login Successful");
        return res.status(200).json({
          token,
          user: {
            id: supervisor.id,
            name: supervisor.name,
            roll_number: supervisor.employee_id,
            department: 'Administration',
            email: supervisor.email,
            role: 'admin'
          }
        });
      }
    }

    // Then check students table
    const [students] = await db.query(
      'SELECT * FROM students WHERE email = ? OR roll_number = ? LIMIT 1',
      [identifier, identifier]
    );

    if (!students || students.length === 0) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    const student = students[0];

    // Verify password strictly via bcrypt
    let isMatch = false;
    try {
      isMatch = await bcrypt.compare(password, student.password_hash);
    } catch (e) {
      isMatch = false;
    }

    if (!isMatch && process.env.NODE_ENV !== 'production') {
      // Fallback for unhashed legacy seed data in non-production only
      isMatch = (password === student.password_hash);
    }

    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid password' });
    }

    // Generate JWT token (7-day production validity)
    const token = jwt.sign(
      { studentId: student.id, rollNumber: student.roll_number, role: 'student', name: student.name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    console.log("Login Successful");

    res.status(200).json({
      token,
      user: {
        id: student.id,
        name: student.name,
        roll_number: student.roll_number,
        department: student.department,
        email: student.email,
        role: 'student'
      }
    });
  } catch (error) {
    console.error("SQL Error Details:", error);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

// Supervisor Login
const supervisorLogin = async (req, res) => {
  const username = req.body.username || req.body.roll_number || req.body.employee_id || req.body.email;
  const password = req.body.password;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username/Email and password are required' });
  }

  try {
    const [supervisors] = await db.query(
      'SELECT * FROM supervisors WHERE employee_id = ? OR email = ? LIMIT 1',
      [username, username]
    );

    if (!supervisors || supervisors.length === 0) {
      return res.status(400).json({ error: 'Invalid username/email or password' });
    }

    const supervisor = supervisors[0];

    // Verify password
    let isMatch = (password === supervisor.password_hash);
    if (!isMatch) {
      try {
        isMatch = await bcrypt.compare(password, supervisor.password_hash);
      } catch (e) {
        isMatch = false;
      }
    }

    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid password' });
    }

    // Generate JWT token (extended to 365 days)
    const token = jwt.sign(
      { studentId: 0, rollNumber: supervisor.employee_id, role: 'admin', name: supervisor.name },
      JWT_SECRET,
      { expiresIn: '365d' }
    );

    console.log("Login Successful");

    res.status(200).json({
      token,
      user: {
        id: supervisor.id,
        name: supervisor.name,
        roll_number: supervisor.employee_id,
        department: 'Administration',
        email: supervisor.email,
        role: 'admin'
      }
    });
  } catch (error) {
    console.error("SQL Error Details:", error);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

const getMe = async (req, res) => {
  if (req.userId === 0) {
    return res.status(200).json({
      id: 0,
      name: 'Mess Supervisor',
      roll_number: 'admin',
      department: 'Administration',
      email: 'supervisor@shakthimess.edu',
      role: 'admin'
    });
  }

  try {
    const [students] = await db.query(
      'SELECT id, name, roll_number, department, email FROM students WHERE id = ? LIMIT 1',
      [req.userId]
    );
    if (!students || students.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const student = students[0];
    res.status(200).json({
      id: student.id,
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
