const mongoose = require('mongoose');

const MealDetailSchema = new mongoose.Schema({
  name: { type: String, default: '' },
  items: [{ type: String }], // Array of food items e.g. ["Idli", "Sambar", "Chutney"]
  description: { type: String, default: '' },
  is_veg: { type: Boolean, default: true },
  category: { type: String, default: 'Standard' }, // Standard, South Indian, North Indian, Chinese, Special
  prep_notes: { type: String, default: '' },
  image: { type: String, default: '' }, // Image URL or base64
  calories: { type: Number, default: 350 },
  quantity: { type: Number, default: 500 },
  status: { type: String, default: 'Available', enum: ['Available', 'Unavailable', 'Special Menu', 'Festival Menu', 'Holiday'] }
}, { _id: false });

const MenuSchema = new mongoose.Schema({
  date: { type: String, required: true, unique: true, index: true }, // YYYY-MM-DD
  day_of_week: { type: String, default: '' },
  breakfast: { type: MealDetailSchema, default: () => ({ name: 'Breakfast', items: ['Idli', 'Sambar', 'Chutney', 'Tea/Coffee'], status: 'Available', calories: 350 }) },
  lunch: { type: MealDetailSchema, default: () => ({ name: 'Lunch', items: ['Rice', 'Sambar', 'Curry', 'Rasum', 'Curd'], status: 'Available', calories: 650 }) },
  dinner: { type: MealDetailSchema, default: () => ({ name: 'Dinner', items: ['Chapati', 'Dal', 'Rice', 'Curd'], status: 'Available', calories: 500 }) },
  is_published: { type: Boolean, default: true },
  special_notice: { type: String, default: '' },
  updatedBy: { type: String, default: 'Supervisor' }
}, { timestamps: true });

module.exports = mongoose.model('Menu', MenuSchema);
