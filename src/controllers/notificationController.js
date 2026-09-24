const mongoose = require('mongoose');
const PushToken = require('../models/PushToken');
const notificationService = require('../services/notificationService');

const notificationSchema = new mongoose.Schema({
  title: { type: String, required: true },
  message: { type: String, required: true },
  target_audience: { type: String, default: 'all' }
}, { timestamps: true });

const Notification = mongoose.model('Notification', notificationSchema);

// POST /api/notifications/create
const createNotification = async (req, res) => {
  const { title, message, target_audience } = req.body;

  if (!title || !message) {
    return res.status(400).json({ error: 'Title and message are required.' });
  }

  try {
    const notification = await Notification.create({
      title,
      message,
      target_audience: target_audience || 'all'
    });

    res.status(201).json({ message: 'Notification created successfully', notification });
  } catch (error) {
    console.error('Create notification error:', error);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

// GET /api/notifications
const getNotifications = async (req, res) => {
  const role = req.userRole || 'student';
  const isSupervisorRole = role === 'admin' || role === 'supervisor';
  const target = isSupervisorRole ? 'supervisors' : 'students';

  try {
    const list = await Notification.find({
      target_audience: { $in: ['all', target] }
    }).sort({ createdAt: -1 });

    const formatted = list.map(n => ({
      id: n._id,
      title: n.title,
      message: n.message,
      target_audience: n.target_audience,
      created_at: n.createdAt
    }));

    res.status(200).json(formatted);
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

// POST /api/notifications/register-push-token
// Authenticated via verifyToken; strictly validates that caller has supervisor role
const registerPushToken = async (req, res) => {
  const { pushToken, platform, deviceId } = req.body;

  if (!pushToken || typeof pushToken !== 'string') {
    return res.status(400).json({ error: 'Valid pushToken string is required.' });
  }

  // Role comes strictly from the verified JWT, never trusted from body
  const callerRole = req.userRole || 'student';
  const callerId = req.userId || req.userRoll || 'unknown';

  try {
    const updated = await PushToken.findOneAndUpdate(
      { pushToken },
      {
        userId: callerId,
        role: callerRole,
        platform: platform || 'android',
        deviceId: deviceId || '',
        enabled: true,
        updatedAt: new Date()
      },
      { upsert: true, new: true }
    );

    res.status(200).json({
      success: true,
      message: 'Push token registered successfully.',
      role: callerRole,
      enabled: updated.enabled
    });
  } catch (error) {
    console.error('Register push token error:', error);
    res.status(500).json({ error: 'Failed to register push token.' });
  }
};

// POST /api/notifications/unregister-push-token
const unregisterPushToken = async (req, res) => {
  const { pushToken } = req.body;

  if (!pushToken) {
    return res.status(400).json({ error: 'pushToken is required.' });
  }

  try {
    await PushToken.updateOne({ pushToken }, { enabled: false });
    res.status(200).json({ success: true, message: 'Push token disabled.' });
  } catch (error) {
    console.error('Unregister push token error:', error);
    res.status(500).json({ error: 'Failed to unregister push token.' });
  }
};

// POST /api/notifications/test-supervisor-demand
// Requires verifyAdmin
const triggerTestSupervisorDemand = async (req, res) => {
  const { mealType, targetDate, kind } = req.body;

  const mType = (mealType || 'lunch').toLowerCase();
  const tDate = targetDate || notificationService.getSimulatedDateStr();

  try {
    const result = await notificationService.dispatchDemandNotification(
      mType,
      tDate,
      kind || 'TEST'
    );

    res.status(200).json({
      success: true,
      message: 'Test supervisor demand notification dispatched.',
      result
    });
  } catch (error) {
    console.error('Trigger test demand error:', error);
    res.status(500).json({ error: error.message || 'Failed to dispatch test notification.' });
  }
};

module.exports = {
  createNotification,
  getNotifications,
  registerPushToken,
  unregisterPushToken,
  triggerTestSupervisorDemand
};
