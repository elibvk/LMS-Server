// server/models/QuizSession.js
const mongoose = require('mongoose');

const quizSessionSchema = new mongoose.Schema({
  quizCode: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  question: {
    type: String,
    required: true
  },
  options: {
    type: [String],
    required: true,
    validate: [arr => arr.length === 4, 'Must have exactly 4 options']
  },
  correctAnswer: {
    type: Number, // Index 0-3
    required: true,
    min: 0,
    max: 3
  },
  difficulty: {
    type: String,
    enum: ['easy', 'medium', 'hard'],
    default: 'medium'
  },
  explanation: {
    type: String,
    required: true
  },
  duration: {
    type: Number, // in seconds
    required: true,
    min: 10,
    max: 3600
  },
  startedAt: {
    type: Date,
    required: true,
    default: Date.now
  },
  expiresAt: {
    type: Date,
    required: true
  },
  createdBy: {
    type: String, // email (matches your admin.email or user.email)
    required: true
  },
  createdByName: {
    type: String
  },
  status: {
    type: String,
    enum: ['active', 'expired'],
    default: 'active',
    index: true
  },
  courseId: {
    type: String, // projectId like "0001"
    required: true
  },
  courseTitle: {
    type: String
  }
}, {
  timestamps: true
});

// Indexes for performance
quizSessionSchema.index({ quizCode: 1, status: 1 });
quizSessionSchema.index({ expiresAt: 1 });

// Check if expired
quizSessionSchema.methods.isExpired = function() {
  return Date.now() > this.expiresAt;
};

// Get remaining time
quizSessionSchema.methods.getRemainingTime = function() {
  const remaining = Math.floor((this.expiresAt - Date.now()) / 1000);
  return Math.max(0, remaining);
};

// Generate unique 6-digit code
quizSessionSchema.statics.generateUniqueCode = async function() {
  let code;
  let exists = true;
  
  while (exists) {
    code = Math.floor(100000 + Math.random() * 900000).toString();
    exists = await this.findOne({ quizCode: code, status: 'active' });
  }
  
  return code;
};

module.exports = mongoose.model('QuizSession', quizSessionSchema);