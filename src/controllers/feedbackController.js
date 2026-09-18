const Feedback = require('../models/Feedback');
const Student = require('../models/Student');
const { processAndStoreImage } = require('../utils/photoStorage');

// POST /api/feedback
const submitFeedback = async (req, res) => {
  const studentId = req.userId;
  const { rating, comments, meal_type, photo, photo_base64 } = req.body;

  if (rating === undefined || rating === null) {
    return res.status(400).json({ error: 'Rating is required.' });
  }

  const ratingVal = parseInt(rating, 10);
  if (isNaN(ratingVal) || ratingVal < 1 || ratingVal > 5) {
    return res.status(400).json({ error: 'Rating must be an integer between 1 and 5.' });
  }

  // Process optional photo attachment
  const rawImage = photo || photo_base64 || null;
  let photoUrl = '';
  if (rawImage) {
    const photoResult = processAndStoreImage(rawImage);
    if (!photoResult.success) {
      return res.status(photoResult.statusCode || 400).json({ error: photoResult.error });
    }
    photoUrl = photoResult.photoUrl;
  }

  try {
    let student = null;
    if (studentId) {
      student = await Student.findById(studentId);
    }

    const sanitizedComments = typeof comments === 'string' 
      ? comments.replace(/<[^>]*>/g, '').trim().substring(0, 1000) 
      : '';

    const feedback = await Feedback.create({
      student_id: student ? student._id : studentId,
      roll_number: student ? student.roll_number : (req.body.roll_number || 'UNKNOWN'),
      student_name: student ? student.name : (req.body.student_name || 'Student'),
      meal_type: meal_type || 'General',
      rating: ratingVal,
      comments: sanitizedComments,
      photo_url: photoUrl
    });

    res.status(201).json({ 
      message: 'Feedback submitted successfully', 
      feedback: {
        id: feedback._id,
        rating: feedback.rating,
        comments: feedback.comments,
        photo_url: feedback.photo_url,
        meal_type: feedback.meal_type,
        created_at: feedback.createdAt
      }
    });
  } catch (error) {
    console.error('Submit feedback error:', error);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

// GET /api/feedback
const getAllFeedback = async (req, res) => {
  try {
    const feedbackList = await Feedback.find()
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('student_id', 'name roll_number hostel_block department')
      .lean();

    const formatted = feedbackList.map(f => {
      const std = f.student_id || {};
      return {
        id: f._id,
        rating: f.rating,
        comments: f.comments,
        photo_url: f.photo_url || '',
        meal_type: f.meal_type || 'General',
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

// GET /api/feedback/summary
const getFeedbackSummary = async (req, res) => {
  try {
    const aggregate = await Feedback.aggregate([
      {
        $group: {
          _id: null,
          averageRating: { $avg: '$rating' },
          totalFeedback: { $sum: 1 }
        }
      }
    ]);

    if (!aggregate || aggregate.length === 0) {
      return res.status(200).json({
        averageRating: 0,
        totalFeedback: 0
      });
    }

    const { averageRating, totalFeedback } = aggregate[0];
    res.status(200).json({
      averageRating: Math.round((averageRating || 0) * 10) / 10,
      totalFeedback: totalFeedback || 0
    });
  } catch (error) {
    console.error('Get feedback summary error:', error);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

// GET /api/ratings/today
const getTodayRatings = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const studentId = req.userId;

    let filter = { date: today };
    if (studentId) {
      filter.student_id = studentId;
    }

    const ratings = await Feedback.find(filter).sort({ createdAt: -1 }).lean();
    res.status(200).json(ratings);
  } catch (error) {
    console.error('Get today ratings error:', error);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

module.exports = {
  submitFeedback,
  getAllFeedback,
  getFeedbackSummary,
  getTodayRatings
};


