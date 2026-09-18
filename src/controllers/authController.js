const bcrypt = require('bcrypt');
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
    if (error.code === 11000) {
      const keyName = Object.keys(error.keyPattern || {})[0] || 'Roll Number/Email';
      return res.status(400).json({ error: `${keyName} already exists` });
    }
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
      role: req.body.role || 'supervisor'
    });

    res.status(201).json({ success: true, message: 'Supervisor registered successfully', supervisorId: supervisor._id });
    console.log("Supervisor Registered Successfully");
  } catch (error) {
    if (error.code === 11000) {
      const keyName = Object.keys(error.keyPattern || {})[0] || 'Employee ID/Email';
      return res.status(400).json({ error: `${keyName} already exists` });
    }
    console.error("Mongo Error Details:", error);
    res.status(500).json({ error: error.message || 'Database connection failed' });
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
    // 1. Check student collection first
    const student = await Student.findOne({
      $or: [{ email: identifier }, { roll_number: identifier }]
    });

    if (student) {
      let isMatch = false;
      try {
        isMatch = await bcrypt.compare(password, student.password);
      } catch (e) {
        isMatch = false;
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

      return res.status(200).json({
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
    }

    // 2. Fallback check supervisor collection if student not found
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
      if (isMatch) {
        const supRole = supervisor.role || 'supervisor';
        const token = jwt.sign(
          { studentId: supervisor._id, rollNumber: supervisor.supervisor_id, role: supRole, name: supervisor.name },
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
            role: supRole
          }
        });
      }
    }

    return res.status(400).json({ error: 'Invalid email or password' });
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

    let isMatch = false;
    try {
      isMatch = await bcrypt.compare(password, supervisor.password);
    } catch (e) {
      isMatch = false;
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
    const normRole = (req.userRole || '').toString().toLowerCase().trim();
    const isSupRole = normRole === 'supervisor' || normRole === 'admin' || normRole === 'manager';
    
    if (isSupRole) {
      const supervisor = await Supervisor.findById(req.userId);
      if (supervisor) {
        return res.status(200).json({
          id: supervisor._id,
          name: supervisor.name,
          roll_number: supervisor.supervisor_id,
          department: supervisor.department || 'Administration',
          email: supervisor.email,
          role: supervisor.role || 'supervisor'
        });
      }
    }

    const student = await Student.findById(req.userId);
    if (student) {
      return res.status(200).json({
        id: student._id,
        name: student.name,
        roll_number: student.roll_number,
        department: student.department,
        email: student.email,
        role: 'student'
      });
    }

    const supervisorFallback = await Supervisor.findById(req.userId);
    if (supervisorFallback) {
      return res.status(200).json({
        id: supervisorFallback._id,
        name: supervisorFallback.name,
        roll_number: supervisorFallback.supervisor_id,
        department: supervisorFallback.department || 'Administration',
        email: supervisorFallback.email,
        role: supervisorFallback.role || 'supervisor'
      });
    }

    return res.status(404).json({ error: 'User not found' });
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

// Change Password
const changePassword = async (req, res) => {
  const userId = req.userId;
  const { current_password, new_password, confirm_password, identifier } = req.body;

  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Current password and new password are required.' });
  }

  if (new_password.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters long.' });
  }

  if (confirm_password && new_password !== confirm_password) {
    return res.status(400).json({ error: 'New password and confirmation do not match.' });
  }

  try {
    let user = null;
    let isStudent = false;

    if (userId) {
      user = await Student.findById(userId);
      if (user) {
        isStudent = true;
      } else {
        user = await Supervisor.findById(userId);
      }
    } else if (identifier) {
      // Unauthenticated change password with identifier + current password verification
      user = await Student.findOne({
        $or: [{ email: identifier }, { roll_number: identifier }]
      });
      if (user) {
        isStudent = true;
      } else {
        user = await Supervisor.findOne({
          $or: [{ email: identifier }, { supervisor_id: identifier }]
        });
      }
    }

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    let isMatch = false;
    try {
      isMatch = await bcrypt.compare(current_password, user.password);
    } catch (e) {
      isMatch = false;
    }

    if (!isMatch) {
      return res.status(400).json({ error: 'Current password is incorrect.' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(new_password, salt);

    user.password = passwordHash;
    await user.save();

    console.log(`Password changed successfully for ${isStudent ? 'student' : 'supervisor'}: ${user.email || user.roll_number}`);

    res.status(200).json({
      success: true,
      message: 'Password changed successfully. Please log in with your new password.'
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Database error during password change.' });
  }
};

// Forgot Password Request
const forgotPassword = async (req, res) => {
  const { identifier } = req.body;
  if (!identifier) {
    return res.status(400).json({ error: 'Roll number or Email is required.' });
  }

  try {
    const student = await Student.findOne({
      $or: [{ email: identifier }, { roll_number: identifier }]
    });

    const user = student || await Supervisor.findOne({
      $or: [{ email: identifier }, { supervisor_id: identifier }]
    });

    if (!user) {
      return res.status(404).json({ error: 'No account found matching this identifier.' });
    }

    // Check device binding if device token is passed
    const clientDeviceToken = req.headers['x-smartmess-device-token'] || req.body.device_token;
    if (student && student.registered_device_token && clientDeviceToken && clientDeviceToken !== student.registered_device_token) {
      return res.status(403).json({
        error: 'Unregistered device. Please contact your Supervisor to reset device binding.',
        code: 'DEVICE_UNREGISTERED'
      });
    }

    // Issue short-lived password reset token (15 mins)
    const resetToken = jwt.sign(
      {
        userId: user._id,
        identifier: user.roll_number || user.supervisor_id,
        purpose: 'password_reset'
      },
      JWT_SECRET,
      { expiresIn: '15m' }
    );

    res.status(200).json({
      success: true,
      message: 'Reset authorization granted.',
      reset_token: resetToken
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Database error processing password recovery.' });
  }
};

// Reset Password with Token
const resetPassword = async (req, res) => {
  const { reset_token, new_password, confirm_password } = req.body;

  if (!reset_token || !new_password) {
    return res.status(400).json({ error: 'Reset token and new password are required.' });
  }

  if (new_password.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters long.' });
  }

  if (confirm_password && new_password !== confirm_password) {
    return res.status(400).json({ error: 'New password and confirmation do not match.' });
  }

  try {
    const decoded = jwt.verify(reset_token, JWT_SECRET);
    if (!decoded || decoded.purpose !== 'password_reset') {
      return res.status(400).json({ error: 'Invalid or expired password reset token.' });
    }

    let user = await Student.findById(decoded.userId);
    if (!user) {
      user = await Supervisor.findById(decoded.userId);
    }

    if (!user) {
      return res.status(404).json({ error: 'User account not found.' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(new_password, salt);

    user.password = passwordHash;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Password reset successfully. You may now log in with your new password.'
    });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(400).json({ error: 'Password reset session expired. Please try again.' });
    }
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Database error resetting password.' });
  }
};

module.exports = {
  studentRegister,
  supervisorRegister,
  studentLogin,
  supervisorLogin,
  getMe,
  changePassword,
  forgotPassword,
  resetPassword
};
