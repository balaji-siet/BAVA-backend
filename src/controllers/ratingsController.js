const db = require('../config/db');

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

  const sanitizedComment = comment ? comment.replace(/<[^>]*>/g, '').trim() : null;

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
    // Check if rating already exists for this student, date, and meal
    const [existing] = await db.query(
      'SELECT id FROM FoodRatings WHERE student_id = ? AND date = ? AND meal_type = ? LIMIT 1',
      [student_id, today, meal_type]
    );

    if (existing && existing.length > 0) {
      await db.query(
        'UPDATE FoodRatings SET rating = ?, comment = ? WHERE student_id = ? AND date = ? AND meal_type = ?',
        [ratingVal, sanitizedComment, student_id, today, meal_type]
      );
    } else {
      await db.query(
        'INSERT INTO FoodRatings (student_id, date, meal_type, rating, comment) VALUES (?, ?, ?, ?, ?)',
        [student_id, today, meal_type, ratingVal, sanitizedComment]
      );
    }

    res.status(200).json({ message: 'Rating saved successfully' });
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
    const [rows] = await db.query(
      'SELECT meal_type, rating, comment FROM FoodRatings WHERE student_id = ? AND date = ?',
      [student_id, today]
    );
    res.status(200).json(rows || []);
  } catch (error) {
    console.error('Fetch today ratings error:', error);
    res.status(500).json({ error: 'Database error fetching today\'s ratings' });
  }
};

// Get ratings analytics for supervisor
const getRatingAnalytics = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT 
        meal_type, 
        ROUND(AVG(rating), 2) as average_rating, 
        COUNT(rating) as total_ratings 
      FROM FoodRatings 
      GROUP BY meal_type`
    );

    // Get recent comments
    const [comments] = await db.query(
      `SELECT r.meal_type, r.rating, r.comment, r.date, s.name as student_name
       FROM FoodRatings r
       JOIN Students s ON r.student_id = s.id
       WHERE r.comment IS NOT NULL AND r.comment != ''
       ORDER BY r.created_at DESC
       LIMIT 10`
    );

    const formattedComments = comments ? comments.map(c => {
      let dateVal = c.date;
      if (dateVal instanceof Date) {
        dateVal = dateVal.toISOString().split('T')[0];
      }
      return { ...c, date: dateVal };
    }) : [];

    res.status(200).json({
      summary: rows || [],
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
