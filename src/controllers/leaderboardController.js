const db = require('../config/db');

// Get top students sorted by points
const getLeaderboard = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT name, roll_number, department, hostel_block, points 
       FROM Students 
       ORDER BY points DESC 
       LIMIT 10`
    );
    res.status(200).json(rows || []);
  } catch (error) {
    console.error('Fetch leaderboard error:', error);
    res.status(500).json({ error: 'Database error fetching leaderboard' });
  }
};

// Manually award/deduct points (Admin only)
const awardPoints = async (req, res) => {
  const { rollNumber, points } = req.body;

  if (!rollNumber || points === undefined) {
    return res.status(400).json({ error: 'rollNumber and points are required' });
  }

  const pointsVal = parseInt(points, 10);
  if (isNaN(pointsVal)) {
    return res.status(400).json({ error: 'Points must be a valid integer' });
  }

  try {
    const [result] = await db.query(
      'UPDATE Students SET points = points + ? WHERE roll_number = ?',
      [pointsVal, rollNumber]
    );

    if (result && result.affectedRows === 0) {
      return res.status(404).json({ error: 'Student with given roll number not found' });
    }

    res.status(200).json({ message: `Successfully adjusted student points by ${pointsVal}` });
  } catch (error) {
    console.error('Award points error:', error);
    res.status(500).json({ error: 'Database error adjusting points' });
  }
};

module.exports = {
  getLeaderboard,
  awardPoints
};
