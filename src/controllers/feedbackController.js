const db = require('../config/db');

// POST /api/feedback
const submitFeedback = async (req, res) => {
  const studentId = req.userId;
  const { rating, comments } = req.body;

  if (rating === undefined) {
    return res.status(400).json({ error: 'Rating is required.' });
  }

  try {
    await db.query(
      'INSERT INTO feedback (student_id, rating, comments) VALUES (?, ?, ?)',
      [studentId, rating, comments || null]
    );

    res.status(201).json({ message: 'Feedback submitted successfully' });
  } catch (error) {
    console.error('Submit feedback error:', error);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

// GET /api/feedback
const getAllFeedback = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT f.id, f.rating, f.comments, f.created_at, s.name, s.roll_number, s.hostel_block, s.department
       FROM feedback f
       JOIN students s ON f.student_id = s.id
       ORDER BY f.created_at DESC`
    );

    res.status(200).json(rows);
  } catch (error) {
    console.error('Get all feedback error:', error);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

module.exports = {
  submitFeedback,
  getAllFeedback
};
