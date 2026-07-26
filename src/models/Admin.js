const mongoose = require('mongoose');

const adminSchema = new mongoose.Schema({
  admin_id: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, index: true },
  password: { type: String, required: true },
  role: { type: String, default: 'admin' }
}, {
  timestamps: true
});

module.exports = mongoose.model('Admin', adminSchema);
