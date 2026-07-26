const mongoose = require('mongoose');

const supervisorSchema = new mongoose.Schema({
  supervisor_id: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, index: true },
  phone: { type: String, default: '' },
  password: { type: String, required: true },
  role: { type: String, default: 'supervisor' }
}, {
  timestamps: true
});

module.exports = mongoose.model('Supervisor', supervisorSchema);
