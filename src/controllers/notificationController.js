const mongoose = require('mongoose');

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
  const target = role === 'admin' ? 'supervisors' : 'students';

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

module.exports = {
  createNotification,
  getNotifications
};
