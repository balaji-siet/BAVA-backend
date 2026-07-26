const Student = require('../models/Student');

// Get top students sorted by points
const getLeaderboard = async (req, res) => {
  try {
    const students = await Student.find()
      .select('name roll_number department hostel_block points')
      .sort({ points: -1 })
      .limit(10);

    const formatted = students.map(s => ({
      name: s.name,
      roll_number: s.roll_number,
      department: s.department,
      hostel_block: s.hostel_block || 'A',
      points: s.points || 0
    }));

    res.status(200).json(formatted);
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
    const student = await Student.findOneAndUpdate(
      { roll_number: rollNumber },
      { $inc: { points: pointsVal } },
      { new: true }
    );

    if (!student) {
      return res.status(404).json({ error: 'Student with given roll number not found' });
    }

    res.status(200).json({ message: `Successfully adjusted student points by ${pointsVal}`, points: student.points });
  } catch (error) {
    console.error('Award points error:', error);
    res.status(500).json({ error: 'Database error adjusting points' });
  }
};

module.exports = {
  getLeaderboard,
  awardPoints
};
