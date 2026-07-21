const db = require('../config/db');

// POST /api/notifications/create
const createNotification = async (req, res) => {
  const { title, message, target_audience } = req.body;

  if (!title || !message) {
    return res.status(400).json({ error: 'Title and message are required.' });
  }

  try {
    const audience = target_audience || 'all';
    await db.query(
      'INSERT INTO notifications (title, message, target_audience) VALUES (?, ?, ?)',
      [title, message, audience]
    );

    res.status(201).json({ message: 'Notification created successfully' });
  } catch (error) {
    console.error('Create notification error:', error);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

// GET /api/notifications
const getNotifications = async (req, res) => {
  const role = req.userRole || 'student';

  try {
    // Return all notifications matching target audience
    const [rows] = await db.query(
      'SELECT id, title, message, target_audience, created_at FROM notifications WHERE target_audience = ? OR target_audience = "all" ORDER BY created_at DESC',
      [role === 'admin' ? 'supervisors' : 'students']
    );

    res.status(200).json(rows);
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

module.exports = {
  createNotification,
  getNotifications
};
