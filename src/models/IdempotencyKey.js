const mongoose = require('mongoose');

const idempotencyKeySchema = new mongoose.Schema({
  key: { 
    type: String, 
    required: true, 
    unique: true, 
    index: true 
  },
  response: { 
    type: mongoose.Schema.Types.Mixed, 
    required: true 
  },
  statusCode: { 
    type: Number, 
    default: 200 
  },
  createdAt: { 
    type: Date, 
    default: Date.now, 
    expires: 86400 // TTL index: auto-delete after 24 hours
  }
});

module.exports = mongoose.model('IdempotencyKey', idempotencyKeySchema);
