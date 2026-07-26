const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const mongoose = require('mongoose');

const { getMongoError } = require('../config/mongodb');

const Student = require('../models/Student');
const Supervisor = require('../models/Supervisor');
const Reservation = require('../models/Reservation');
const Attendance = require('../models/Attendance');

const authController = require('../controllers/authController');
const reservationController = require('../controllers/reservationController');
const attendanceController = require('../controllers/attendanceController');
const analyticsController = require('../controllers/analyticsController');
const reportController = require('../controllers/reportController');
const notificationController = require('../controllers/notificationController');
const menuController = require('../controllers/menuController');
const feedbackController = require('../controllers/feedbackController');

const { verifyToken, verifyAdmin } = require('../middleware/auth');
const rateLimiter = require('../middleware/rateLimiter');

// --- API HEALTH CHECK ROUTES ---
router.get('/', (req, res) => {
  const isConnected = mongoose.connection.readyState === 1;
  const errorReason = getMongoError();

  if (isConnected) {
    res.status(200).json({
      status: 'healthy',
      server: 'SMART MESS Backend',
      database: 'connected'
    });
  } else {
    res.status(200).json({
      status: 'healthy',
      server: 'SMART MESS Backend',
      database: 'disconnected',
      reason: errorReason || 'MongoDB Atlas connection in progress or unreachable'
    });
  }
});

router.get('/health', (req, res) => {
  const isConnected = mongoose.connection.readyState === 1;
  const errorReason = getMongoError();

  if (isConnected) {
    res.status(200).json({
      status: 'healthy',
      server: 'SMART MESS Backend',
      database: 'connected'
    });
  } else {
    res.status(200).json({
      status: 'healthy',
      server: 'SMART MESS Backend',
      database: 'disconnected',
      reason: errorReason || 'MongoDB Atlas connection in progress or unreachable'
    });
  }
});

router.get('/database/health', async (req, res) => {
  const state = mongoose.connection.readyState;
  const errorReason = getMongoError();

  if (state === 1) {
    return res.status(200).json({
      database: 'connected',
      databaseType: 'MongoDB Atlas',
      status: 'healthy'
    });
  } else {
    return res.status(200).json({
      database: 'unreachable',
      status: 'degraded',
      message: errorReason || 'MongoDB Atlas connection not active'
    });
  }
});

// Express validation error handler middleware
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg });
  }
  next();
};

const registerValidation = [
  body('name').notEmpty().withMessage('Name is required'),
  body('roll_number').notEmpty().withMessage('Roll Number is required'),
  body('department').notEmpty().withMessage('Department is required'),
  body('email').isEmail().withMessage('Invalid email format'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
  validate
];

// --- AUTHENTICATION MODULE ---
router.post('/student/register', rateLimiter(10, 15 * 60 * 1000), registerValidation, authController.studentRegister);
router.post('/student/login', rateLimiter(15, 15 * 60 * 1000), authController.studentLogin);
router.post('/supervisor/register', rateLimiter(10, 15 * 60 * 1000), authController.supervisorRegister);
router.post('/supervisor/login', rateLimiter(15, 15 * 60 * 1000), authController.supervisorLogin);

// Auth Aliases for client compatibility
router.post('/register', rateLimiter(10, 15 * 60 * 1000), (req, res, next) => {
  if (req.body.role === 'admin' || req.body.role === 'supervisor') {
    return authController.supervisorRegister(req, res, next);
  }
  return authController.studentRegister(req, res, next);
});
router.post('/login', rateLimiter(15, 15 * 60 * 1000), authController.studentLogin);
router.get('/me', verifyToken, authController.getMe);

// --- MEAL RESERVATION MODULE ---
router.post('/reservations/create', verifyToken, reservationController.saveReservations);
router.get('/reservations/history', verifyToken, reservationController.getReservationsHistory);

// Reservation Aliases for client compatibility
router.post('/reservations', verifyToken, reservationController.saveReservations);
router.post('/reserve-meal', verifyToken, reservationController.saveReservations);
router.post('/cancel-reservation', verifyToken, reservationController.cancelReservation);
router.get('/reservations/today', verifyToken, reservationController.getReservationsByDate);

// --- ATTENDANCE MODULE ---
router.post('/attendance/mark', verifyToken, attendanceController.markAttendance);
router.get('/attendance/student', verifyToken, attendanceController.getStudentAttendance);
router.get('/attendance/all', verifyAdmin, attendanceController.getAllAttendance);

// Attendance Aliases for client compatibility
router.get('/attendance', verifyToken, attendanceController.getStudentAttendance);

// --- ANALYTICS MODULE ---
router.get('/dashboard', verifyAdmin, analyticsController.getDashboardAnalytics);
router.get('/students/non-attending', verifyAdmin, analyticsController.getNonAttendingStudents);

// --- REPORT MODULE ---
router.get('/reports/daily', verifyAdmin, reportController.getDailyReport);
router.get('/reports/weekly', verifyAdmin, reportController.getWeeklyReport);
router.get('/reports/monthly', verifyAdmin, reportController.getMonthlyReport);

// Report Aliases for client compatibility
router.get('/reports', verifyAdmin, reportController.getDailyReport);

// --- NOTIFICATION MODULE ---
router.post('/notifications/create', verifyAdmin, notificationController.createNotification);
router.get('/notifications', verifyToken, notificationController.getNotifications);

// --- MENU MANAGEMENT ---
router.post('/menu/create', verifyAdmin, menuController.createMenu);
router.put('/menu/update', verifyAdmin, menuController.updateMenu);
router.delete('/menu/delete', verifyAdmin, menuController.deleteMenu);
router.get('/menu', verifyToken, menuController.getMenu);

// --- FEEDBACK MODULE ---
router.post('/feedback', verifyToken, feedbackController.submitFeedback);
router.get('/feedback', verifyAdmin, feedbackController.getAllFeedback);

// --- DEBUG & TIME SIMULATION HELPERS ---
router.get('/debug/time', reservationController.getDebugInfo);

router.get('/diagnostics', async (req, res) => {
  const startTime = Date.now();
  const errorReason = getMongoError();
  try {
    const studentsCount = await Student.countDocuments();
    const supervisorsCount = await Supervisor.countDocuments();
    const reservationsCount = await Reservation.countDocuments();
    const attendanceCount = await Attendance.countDocuments();
    
    const duration = Date.now() - startTime;
    return res.status(200).json({
      status: 'online',
      databaseName: 'MongoDB Atlas',
      connectionStatus: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected',
      errorReason: errorReason || null,
      totalStudents: studentsCount,
      totalSupervisors: supervisorsCount,
      totalReservations: reservationsCount,
      totalAttendance: attendanceCount,
      responseTimeMs: duration,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error("Mongo Error Details:", err);
    return res.status(500).json({
      status: 'online',
      databaseName: 'MongoDB Atlas',
      connectionStatus: 'Error',
      error: errorReason || err.message || 'Database connection error',
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
