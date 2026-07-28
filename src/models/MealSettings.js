const mongoose = require('mongoose');

const MealWindowSchema = new mongoose.Schema({
  open_time: { type: String, required: true, default: '06:00' }, // HH:mm format
  close_time: { type: String, required: true, default: '09:30' }, // HH:mm format
  open_date: { type: String, default: '' }, // YYYY-MM-DD if different from date
  close_date: { type: String, default: '' }, // YYYY-MM-DD if different from date
  enabled: { type: Boolean, default: true },
  sms_sent: { type: Boolean, default: false }
}, { _id: false });

const MealSettingsSchema = new mongoose.Schema({
  date: { type: String, required: true, unique: true, index: true }, // YYYY-MM-DD
  breakfast: {
    type: MealWindowSchema,
    default: () => ({ open_time: '06:00', close_time: '09:30', enabled: true, sms_sent: false })
  },
  lunch: {
    type: MealWindowSchema,
    default: () => ({ open_time: '10:30', close_time: '13:00', enabled: true, sms_sent: false })
  },
  dinner: {
    type: MealWindowSchema,
    default: () => ({ open_time: '17:00', close_time: '20:00', enabled: true, sms_sent: false })
  },
  updatedBy: { type: String, default: 'System' }
}, { timestamps: true });

module.exports = mongoose.model('MealSettings', MealSettingsSchema);
