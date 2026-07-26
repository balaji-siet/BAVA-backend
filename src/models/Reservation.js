const mongoose = require('mongoose');

const reservationSchema = new mongoose.Schema({
  student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
  roll_number: { type: String, required: true, index: true },
  reservation_date: { type: String, required: true, index: true }, // YYYY-MM-DD
  breakfast: { type: Boolean, default: false },
  lunch: { type: Boolean, default: false },
  dinner: { type: Boolean, default: false }
}, {
  timestamps: true
});

reservationSchema.index({ roll_number: 1, reservation_date: 1 }, { unique: true });

module.exports = mongoose.model('Reservation', reservationSchema);
