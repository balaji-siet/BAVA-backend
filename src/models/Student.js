const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  roll_number: { type: String, required: true, unique: true, index: true },
  department: { type: String, required: true },
  year: { type: String, default: '1' },
  hostel_block: { type: String, default: 'A' },
  room_number: { type: String, default: '101' },
  email: { type: String, required: true, unique: true, index: true },
  phone: { type: String, default: '' },
  password: { type: String, required: true },
  nfc_card_id: { type: String, default: null, index: true },
  reservationDeviceTokenHash: { type: String, default: null, select: false },
  reservationDeviceBoundAt: { type: Date, default: null },
  reservationDeviceLastUsedAt: { type: Date, default: null },
  reservationDeviceResetAt: { type: Date, default: null },
  points: { type: Number, default: 0 },
  status: { type: String, default: 'active' }
}, {
  timestamps: true
});

module.exports = mongoose.model('Student', studentSchema);
