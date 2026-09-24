const mongoose = require('mongoose');

const notificationDispatchLogSchema = new mongoose.Schema({
  eventKey: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  mealType: {
    type: String,
    required: true
  },
  targetDate: {
    type: String,
    required: true
  },
  triggerKind: {
    type: String,
    enum: ['30MIN', 'FINAL', 'SUMMARY', 'TEST'],
    required: true
  },
  demandCount: {
    type: Number,
    required: true
  },
  title: {
    type: String,
    required: true
  },
  body: {
    type: String,
    required: true
  },
  recipientCount: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['SUCCESS', 'FAILED', 'SKIPPED'],
    default: 'SUCCESS'
  },
  responsePayload: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('NotificationDispatchLog', notificationDispatchLogSchema);
