const mongoose = require('mongoose');

const SMSLogSchema = new mongoose.Schema({
  meal: { type: String, required: true }, // 'breakfast', 'lunch', 'dinner'
  reservation_count: { type: Number, required: true, default: 0 },
  date: { type: String, required: true }, // YYYY-MM-DD
  cutoff_time: { type: String, required: true },
  sent_to: { type: String, required: true }, // Mobile number
  status: { type: String, required: true, enum: ['sent', 'failed', 'simulated'], default: 'sent' },
  provider: { type: String, required: true, default: 'simulator' }, // twilio, fast2sms, msg91, aws_sns, simulator
  message_id: { type: String, default: '' },
  message_body: { type: String, default: '' },
  error_details: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('SMSLog', SMSLogSchema);
