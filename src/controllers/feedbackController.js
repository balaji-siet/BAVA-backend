const Feedback = require('../models/Feedback');
const Student = require('../models/Student');

// POST /api/feedback
const submitFeedback = async (req, res) => {
  const studentId = req.userId;
  const { rating, comments, meal_type } = req.body;

  if (rating === undefined) {
    return res.status(400).json({ error: 'Rating is required.' });
  }

  try {
    let student = null;
    if (studentId) {
      student = await Student.findById(studentId);
    }

    const feedback = await Feedback.create({
      student_id: student ? student._id : studentId,
      roll_number: student ? student.roll_number : (req.body.roll_number || 'UNKNOWN'),
      student_name: student ? student.name : (req.body.student_name || 'Student'),
      meal_type: meal_type || 'General',
      rating,
      comments: comments || ''
    });

    res.status(201).json({ message: 'Feedback submitted successfully', feedback });
  } catch (error) {
    console.error('Submit feedback error:', error);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

// GET /api/feedback
const getAllFeedback = async (req, res) => {
  try {
    const feedbackList = await Feedback.find().sort({ createdAt: -1 }).populate('student_id', 'name roll_number hostel_block department');

    const formatted = feedbackList.map(f => {
      const std = f.student_id || {};
      return {
        id: f._id,
        rating: f.rating,
        comments: f.comments,
        created_at: f.createdAt,
        name: f.student_name || std.name || 'Student',
        roll_number: f.roll_number || std.roll_number || 'N/A',
        hostel_block: std.hostel_block || 'A',
        department: std.department || 'General'
      };
    });

    res.status(200).json(formatted);
  } catch (error) {
    console.error('Get all feedback error:', error);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

module.exports = {
  submitFeedback,
  getAllFeedback
};
