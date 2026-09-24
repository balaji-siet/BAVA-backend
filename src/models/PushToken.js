const mongoose = require('mongoose');

const pushTokenSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  role: {
    type: String,
    required: true,
    enum: ['supervisor', 'admin', 'student'],
    default: 'supervisor'
  },
  pushToken: {
    type: String,
    required: true,
    unique: true
  },
  platform: {
    type: String,
    enum: ['android', 'ios', 'web'],
    default: 'android'
  },
  deviceId: {
    type: String,
    default: ''
  },
  enabled: {
    type: Boolean,
    default: true
  },
  lastDispatchedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Compound index for role-based targeting
pushTokenSchema.index({ role: 1, enabled: 1 });

module.exports = mongoose.model('PushToken', pushTokenSchema);
