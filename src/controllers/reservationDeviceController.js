const crypto = require('crypto');
const bcrypt = require('bcrypt');
const Student = require('../models/Student');

const DEVICE_TOKEN_HEADER = 'x-smartmess-device-token';
const MEAL_PASSWORD_HEADER = 'x-smartmess-meal-password';

const hashDeviceToken = (token) => crypto.createHash('sha256').update(token, 'utf8').digest('hex');

const isStudentRequest = (req) => (req.userRole || '').toLowerCase() === 'student';

const isSupervisorRequest = (req) => {
  const role = (req.userRole || '').toLowerCase();
  return role === 'supervisor' || role === 'admin' || role === 'manager';
};

const requireStudent = (req, res) => {
  if (!isStudentRequest(req)) {
    res.status(403).json({ code: 'STUDENT_ONLY', error: 'Student authorization required.' });
    return false;
  }
  return true;
};

const getDeviceStatus = async (req, res) => {
  if (!requireStudent(req, res)) return;
  const student = await Student.findById(req.userId).select('+reservationDeviceTokenHash reservationDeviceBoundAt reservationDeviceLastUsedAt').lean();
  if (!student) {
    return res.status(404).json({ code: 'STUDENT_NOT_FOUND', error: 'Student account not found.' });
  }
  return res.status(200).json({
    bound: Boolean(student.reservationDeviceTokenHash),
    boundAt: student.reservationDeviceBoundAt || null,
    lastUsedAt: student.reservationDeviceLastUsedAt || null,
  });
};

const enrollDevice = async (req, res) => {
  if (!requireStudent(req, res)) return;
  const student = await Student.findById(req.userId).select('+reservationDeviceTokenHash');
  if (!student) {
    return res.status(404).json({ code: 'STUDENT_NOT_FOUND', error: 'Student account not found.' });
  }
  if (student.reservationDeviceTokenHash) {
    return res.status(403).json({ code: 'DEVICE_ALREADY_BOUND', error: 'This account is already registered to another reservation device.' });
  }

  const token = crypto.randomBytes(32).toString('base64url');
  student.reservationDeviceTokenHash = hashDeviceToken(token);
  student.reservationDeviceBoundAt = new Date();
  student.reservationDeviceLastUsedAt = new Date();
  await student.save();

  return res.status(201).json({ deviceToken: token });
};

const resetStudentDevice = async (req, res) => {
  if (!isSupervisorRequest(req)) {
    return res.status(403).json({ code: 'SUPERVISOR_ONLY', error: 'Supervisor authorization required.' });
  }

  const studentId = req.params.studentId || req.body.studentId;
  if (!studentId) {
    return res.status(400).json({ code: 'STUDENT_REQUIRED', error: 'Student id is required.' });
  }

  const student = await Student.findById(studentId).select('+reservationDeviceTokenHash reservationDeviceBoundAt reservationDeviceLastUsedAt reservationDeviceResetAt');
  if (!student) {
    return res.status(404).json({ code: 'STUDENT_NOT_FOUND', error: 'Student account not found.' });
  }

  student.reservationDeviceTokenHash = null;
  student.reservationDeviceBoundAt = null;
  student.reservationDeviceLastUsedAt = null;
  student.reservationDeviceResetAt = new Date();
  await student.save();

  return res.status(200).json({ message: 'Reservation device reset successfully.' });
};

const validateStudentDeviceBinding = async (req, res) => {
  if (!requireStudent(req, res)) return false;

  const receivedToken = req.headers[DEVICE_TOKEN_HEADER];
  if (!receivedToken || typeof receivedToken !== 'string') {
    res.status(403).json({ code: 'DEVICE_BINDING_REQUIRED', error: 'Registered reservation device is required.' });
    return false;
  }

  const student = await Student.findById(req.userId).select('+reservationDeviceTokenHash');
  if (!student) {
    res.status(404).json({ code: 'STUDENT_NOT_FOUND', error: 'Student account not found.' });
    return false;
  }

  if (!student.reservationDeviceTokenHash) {
    res.status(403).json({ code: 'DEVICE_BINDING_REQUIRED', error: 'No reservation device is registered for this account.' });
    return false;
  }

  const receivedHash = hashDeviceToken(receivedToken);
  const expected = Buffer.from(student.reservationDeviceTokenHash, 'hex');
  const actual = Buffer.from(receivedHash, 'hex');
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    res.status(403).json({ code: 'DEVICE_BINDING_INVALID', error: 'Reservation device token is invalid.' });
    return false;
  }

  await Student.updateOne({ _id: req.userId }, { $set: { reservationDeviceLastUsedAt: new Date() } });
  return true;
};

const validateStudentMealPasswordIfProvided = async (req, res) => {
  const receivedPassword = req.headers[MEAL_PASSWORD_HEADER];
  if (!receivedPassword) return true;
  if (typeof receivedPassword !== 'string') {
    res.status(403).json({ code: 'MEAL_PASSWORD_INVALID', error: 'Reservation authentication failed.' });
    return false;
  }

  const student = await Student.findById(req.userId).select('password');
  if (!student) {
    res.status(404).json({ code: 'STUDENT_NOT_FOUND', error: 'Student account not found.' });
    return false;
  }

  let isMatch = false;
  try {
    isMatch = await bcrypt.compare(receivedPassword, student.password);
  } catch (e) {
    isMatch = false;
  }

  if (!isMatch) {
    res.status(403).json({ code: 'MEAL_PASSWORD_INVALID', error: 'Reservation authentication failed.' });
    return false;
  }

  return true;
};
module.exports = {
  DEVICE_TOKEN_HEADER,
  MEAL_PASSWORD_HEADER,
  hashDeviceToken,
  getDeviceStatus,
  enrollDevice,
  resetStudentDevice,
  validateStudentDeviceBinding,
  validateStudentMealPasswordIfProvided,
};
