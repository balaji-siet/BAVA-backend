const mongoose = require('mongoose');

const menuSchema = new mongoose.Schema({
  day_of_week: { type: String, required: true },
  meal_type: { type: String, enum: ['breakfast', 'lunch', 'dinner'], required: true },
  items: { type: String, required: true }
}, {
  timestamps: true
});

menuSchema.index({ day_of_week: 1, meal_type: 1 }, { unique: true });

module.exports = mongoose.model('Menu', menuSchema);
