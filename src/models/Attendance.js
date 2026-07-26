const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
  roll_number: { type: String, required: true, index: true },
  meal_type: { type: String, enum: ['breakfast', 'lunch', 'dinner'], required: true },
  attendance_date: { type: String, required: true, index: true }, // YYYY-MM-DD
  attendance_status: { type: String, default: 'present' },
  verification_method: { type: String, default: 'nfc' }
}, {
  timestamps: true
});

attendanceSchema.index({ roll_number: 1, attendance_date: 1, meal_type: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', attendanceSchema);
