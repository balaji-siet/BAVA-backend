const Feedback = require('../models/Feedback');
const Student = require('../models/Student');

// Submit or update a food rating for today
const saveRating = async (req, res) => {
  const { meal_type, rating, comment } = req.body;
  const student_id = req.userId;
  
  if (typeof meal_type !== 'string' || (comment !== undefined && typeof comment !== 'string')) {
    return res.status(400).json({ error: 'Invalid input parameter types.' });
  }

  if (!meal_type || rating === undefined) {
    return res.status(400).json({ error: 'meal_type and rating are required' });
  }

  const sanitizedComment = comment ? comment.replace(/<[^>]*>/g, '').trim() : '';
  const validMeals = ['breakfast', 'lunch', 'dinner'];
  if (!validMeals.includes(meal_type)) {
    return res.status(400).json({ error: 'Invalid meal_type. Must be breakfast, lunch, or dinner' });
  }

  const ratingVal = parseInt(rating, 10);
  if (isNaN(ratingVal) || ratingVal < 1 || ratingVal > 5) {
    return res.status(400).json({ error: 'Rating must be an integer between 1 and 5' });
  }

  const today = new Date().toISOString().split('T')[0];

  try {
    let student = null;
    if (student_id) {
      student = await Student.findById(student_id);
    }

    const ratingDoc = await Feedback.findOneAndUpdate(
      {
        $or: [
          { student_id: student ? student._id : student_id, date: today, meal_type },
          { roll_number: student ? student.roll_number : 'UNKNOWN', date: today, meal_type }
        ]
      },
      {
        student_id: student ? student._id : student_id,
        roll_number: student ? student.roll_number : 'UNKNOWN',
        student_name: student ? student.name : 'Student',
        meal_type,
        rating: ratingVal,
        comments: sanitizedComment,
        date: today
      },
      { upsert: true, new: true }
    );

    res.status(200).json({ message: 'Rating saved successfully', rating: ratingDoc });
  } catch (error) {
    console.error('Save rating error:', error);
    res.status(500).json({ error: 'Database error saving food rating' });
  }
};

// Get current student's ratings for today
const getTodayRatings = async (req, res) => {
  const student_id = req.userId;
  const today = new Date().toISOString().split('T')[0];

  try {
    let student = null;
    if (student_id) {
      student = await Student.findById(student_id);
    }

    const ratings = await Feedback.find({
      $or: [
        { student_id: student_id, date: today },
        { roll_number: student ? student.roll_number : req.query.roll_number, date: today }
      ]
    });

    const formatted = ratings.map(r => ({
      meal_type: r.meal_type,
      rating: r.rating,
      comment: r.comments
    }));

    res.status(200).json(formatted);
  } catch (error) {
    console.error('Fetch today ratings error:', error);
    res.status(500).json({ error: "Database error fetching today's ratings" });
  }
};

// Get ratings analytics for supervisor
const getRatingAnalytics = async (req, res) => {
  try {
    const summary = await Feedback.aggregate([
      {
        $group: {
          _id: '$meal_type',
          average_rating: { $avg: '$rating' },
          total_ratings: { $sum: 1 }
        }
      }
    ]);

    const comments = await Feedback.find({ comments: { $ne: '' } })
      .sort({ createdAt: -1 })
      .limit(10);

    const formattedComments = comments.map(c => ({
      meal_type: c.meal_type,
      rating: c.rating,
      comment: c.comments,
      date: c.date,
      student_name: c.student_name
    }));

    res.status(200).json({
      summary: summary.map(s => ({
        meal_type: s._id,
        average_rating: Math.round(s.average_rating * 100) / 100,
        total_ratings: s.total_ratings
      })),
      recentComments: formattedComments
    });
  } catch (error) {
    console.error('Fetch ratings analytics error:', error);
    res.status(500).json({ error: 'Database error fetching ratings analytics' });
  }
};

module.exports = {
  saveRating,
  getTodayRatings,
  getRatingAnalytics
};
