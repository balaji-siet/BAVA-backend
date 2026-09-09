const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const mongoose = require('mongoose');

const { getMongoError } = require('../config/mongodb');
const { getIndiaDateString } = require('../utils/dateUtils');

const Student = require('../models/Student');
const Supervisor = require('../models/Supervisor');
const Reservation = require('../models/Reservation');
const Attendance = require('../models/Attendance');

const authController = require('../controllers/authController');
const reservationController = require('../controllers/reservationController');
const reservationDeviceController = require('../controllers/reservationDeviceController');
const attendanceController = require('../controllers/attendanceController');
const analyticsController = require('../controllers/analyticsController');
const reportController = require('../controllers/reportController');
const notificationController = require('../controllers/notificationController');
const menuController = require('../controllers/menuController');
const feedbackController = require('../controllers/feedbackController');
const mealSettingsController = require('../controllers/mealSettingsController');
const nfcController = require('../controllers/nfcController');

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
  const role = (req.body.role || '').toLowerCase();
  if (role === 'supervisor' || role === 'admin' || req.body.employee_id) {
    return authController.supervisorRegister(req, res, next);
  }
  return authController.studentRegister(req, res, next);
});
router.post('/login', rateLimiter(15, 15 * 60 * 1000), authController.studentLogin);
router.get('/me', verifyToken, authController.getMe);
router.get('/reservation-device/status', verifyToken, reservationDeviceController.getDeviceStatus);
router.post('/reservation-device/enroll', verifyToken, reservationDeviceController.enrollDevice);
router.post('/students/:studentId/reservation-device/reset', verifyAdmin, reservationDeviceController.resetStudentDevice);

// --- MEAL RESERVATION MODULE ---
router.post('/reservations/create', verifyToken, reservationController.saveReservations);
router.get('/reservations/history', verifyToken, reservationController.getReservationsHistory);

// Reservation Aliases for client compatibility
router.post('/reservations', verifyToken, reservationController.saveReservations);
router.post('/reserve-meal', verifyToken, reservationController.saveReservations);
router.post('/cancel-reservation', verifyToken, reservationController.cancelReservation);
router.get('/reservations/today', verifyToken, reservationController.getReservationsByDate);

// Live per-meal reservation counts (Supervisor Dashboard)
router.get('/reservations/counts', verifyToken, async (req, res) => {
  try {
    const date = req.query.date || getIndiaDateString();
    const [breakfast, lunch, dinner] = await Promise.all([
      Reservation.countDocuments({ reservation_date: date, breakfast: true }),
      Reservation.countDocuments({ reservation_date: date, lunch: true }),
      Reservation.countDocuments({ reservation_date: date, dinner: true })
    ]);
    res.status(200).json({
      date,
      breakfast,
      lunch,
      dinner,
      total: breakfast + lunch + dinner
    });
  } catch (err) {
    console.error('[reservations/counts] error:', err);
    res.status(500).json({ error: 'Failed to fetch reservation counts' });
  }
});


// --- DYNAMIC MEAL SETTINGS & SMS MODULE ---
router.get('/meal-settings/today', verifyToken, mealSettingsController.getTodaySettings);
router.get('/meal-settings/:date', verifyToken, mealSettingsController.getSettingsByDate);
router.post('/meal-settings', verifyAdmin, mealSettingsController.saveSettings);
router.post('/meal-settings/copy-tomorrow', verifyAdmin, mealSettingsController.copyTodayToTomorrow);
router.post('/meal-settings/reset-default', verifyAdmin, mealSettingsController.resetToDefault);
router.get('/sms/logs', verifyAdmin, mealSettingsController.getSMSLogs);

// --- ATTENDANCE MODULE ---
router.post('/attendance/mark', verifyToken, attendanceController.markAttendance);
router.get('/attendance/student', verifyToken, attendanceController.getStudentAttendance);
router.get('/attendance/all', verifyAdmin, attendanceController.getAllAttendance);
router.get('/attendance/today', nfcController.getTodayNfcAttendance);
router.get('/attendance/history', async (req, res) => {
  try {
    const { start, end } = req.query;
    const startDate = start || '2026-05-01';
    const endDate = end || getIndiaDateString();
    
    const attendance = await Attendance.aggregate([
      { $match: { attendance_date: { $gte: startDate, $lte: endDate }, attendance_status: 'present' } },
      { 
        $group: { 
          _id: { date: '$attendance_date', meal: '$meal_type' }, 
          count: { $sum: 1 } 
        } 
      }
    ]);
    
    const map = {};
    attendance.forEach(item => {
      const d = item._id.date;
      if (!map[d]) {
        map[d] = { date: d, breakfast_count: 0, lunch_count: 0, dinner_count: 0 };
      }
      if (item._id.meal === 'breakfast') map[d].breakfast_count = item.count;
      if (item._id.meal === 'lunch') map[d].lunch_count = item.count;
      if (item._id.meal === 'dinner') map[d].dinner_count = item.count;
    });
    
    const sorted = Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
    res.status(200).json(sorted);
  } catch (err) {
    console.error('Attendance history error:', err);
    res.status(500).json({ error: 'Failed to fetch attendance history' });
  }
});

// NFC Hardware & Dashboard Endpoints
router.post('/nfc/scan', nfcController.scanNfc);
router.get('/nfc/attendance/today', nfcController.getTodayNfcAttendance);
router.get('/nfc/non-attending', nfcController.getNonAttendingStudents);
router.get('/nfc/reports', nfcController.getAttendanceReports);
router.get('/nfc/reports/export', nfcController.exportReport);
router.get('/nfc/waste-analytics', nfcController.getWasteAnalytics);
router.get('/nfc/dashboard-analytics', nfcController.getDashboardAnalytics);
router.get('/nfc/attendance/me', verifyToken, nfcController.getStudentAttendance);
router.get('/nfc/attendance/student/:rollNumber', verifyAdmin, nfcController.getStudentAttendanceByRollNumber);

// Attendance Aliases for client compatibility
router.get('/attendance', verifyToken, attendanceController.getStudentAttendance);

// --- ANALYTICS MODULE ---
router.get('/dashboard', verifyAdmin, analyticsController.getDashboardAnalytics);
router.get('/students/non-attending', verifyAdmin, analyticsController.getNonAttendingStudents);
router.get('/students', verifyAdmin, analyticsController.getStudentsList);
router.get('/leaderboard', analyticsController.getLeaderboard);
router.get('/forecast', analyticsController.getForecast);
router.get('/forecasts', analyticsController.getForecast);

// --- REPORT MODULE ---
router.get('/reports/daily', verifyAdmin, reportController.getDailyReport);
router.get('/reports/weekly', verifyAdmin, reportController.getWeeklyReport);
router.get('/reports/monthly', verifyAdmin, reportController.getMonthlyReport);

// Report Aliases for client compatibility
router.get('/reports', verifyAdmin, reportController.getDailyReport);

// --- NOTIFICATION MODULE ---
router.post('/notifications/create', verifyAdmin, notificationController.createNotification);
router.get('/notifications', verifyToken, notificationController.getNotifications);

// --- MENU MANAGEMENT MODULE ---
router.get('/menu/today', verifyToken, menuController.getTodayMenu);
router.get('/menu/search', verifyToken, menuController.searchMenu);
router.get('/menu/date/:date', verifyToken, menuController.getMenuByDate);
router.post('/menu', verifyAdmin, menuController.saveDailyMenu);
router.post('/menu/duplicate-yesterday', verifyAdmin, menuController.duplicateYesterday);
router.post('/menu/create', verifyAdmin, menuController.createMenu);
router.put('/menu/update', verifyAdmin, menuController.updateMenu);
router.delete('/menu/delete', verifyAdmin, menuController.deleteMenu);
router.get('/menu', verifyToken, menuController.getTodayMenu);

// --- FEEDBACK MODULE ---
router.post('/feedback', verifyToken, feedbackController.submitFeedback);
router.post('/feedback/submit', verifyToken, feedbackController.submitFeedback);
router.get('/feedback', verifyAdmin, feedbackController.getAllFeedback);
router.get('/ratings/today', verifyToken, feedbackController.getTodayRatings);

// --- DEBUG & TIME SIMULATION HELPERS ---
router.get('/debug/time', reservationController.getDebugInfo);
router.post('/debug/trigger-notification', async (req, res) => {
  try {
    const { mealType, date, time, phoneNumber } = req.body || {};
    const targetMeal = mealType || 'lunch';
    const targetDate = date || getIndiaDateString();
    const targetPhone = phoneNumber || '8015667502';
    
    const count = await Reservation.countDocuments({
      reservation_date: targetDate,
      [targetMeal]: true
    });
    
    const smsLog = `Sri Shakthi Smart Mess final ${targetMeal.toUpperCase()} report for ${targetDate}: ${count} student(s) confirmed. Cutoff closed at ${time || '10:00 PM'}. SMS dispatched to ${targetPhone}.`;
    console.log(`[SMS DISPATCH] ${smsLog}`);
    
    res.status(200).json({
      success: true,
      message: 'Notification triggered successfully',
      count,
      log: smsLog
    });
  } catch (err) {
    console.error('Trigger notification error:', err);
    res.status(500).json({ error: 'Failed to trigger notification' });
  }
});

router.get('/diagnostics', async (req, res) => {
  const startTime = Date.now();
  const errorReason = getMongoError();
  try {
    const [studentsCount, supervisorsCount, reservationsCount, attendanceCount] = await Promise.all([
      Student.estimatedDocumentCount(),
      Supervisor.estimatedDocumentCount(),
      Reservation.estimatedDocumentCount(),
      Attendance.estimatedDocumentCount()
    ]);
    
    const { getMongoStats } = require('../config/mongodb');
    const dbStats = await getMongoStats();

    const duration = Date.now() - startTime;
    return res.status(200).json({
      status: 'online',
      databaseStatus: 'connected',
      connectionStatus: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected',
      errorReason: errorReason || null,
      totalStudents: studentsCount,
      totalSupervisors: supervisorsCount,
      totalReservations: reservationsCount,
      totalAttendance: attendanceCount,
      mongoStats: dbStats,
      maxPoolSizeConfig: parseInt(process.env.MONGO_MAX_POOL_SIZE || '50', 10),
      workerCountConfig: parseInt(process.env.WORKER_COUNT || '1', 10),
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
