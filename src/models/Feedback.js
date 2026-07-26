const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema({
  student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
  roll_number: { type: String, required: true },
  student_name: { type: String, required: true },
  meal_type: { type: String, required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comments: { type: String, default: '' },
  date: { type: String, default: () => new Date().toISOString().split('T')[0] }
}, {
  timestamps: true
});

module.exports = mongoose.model('Feedback', feedbackSchema);
