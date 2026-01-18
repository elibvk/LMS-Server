// server/models/QuizSession.js
const mongoose = require('mongoose');

const quizSessionSchema = new mongoose.Schema({
  quizCode: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  // Session Type: 'single' = one question with timer, 'class' = multi-question session
  sessionType: {
    type: String,
    enum: ['single', 'class'],
    default: 'single',
    required: true
  },
  
  // For single question sessions
  questionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'QuizQuestion',
    required: function() { return this.sessionType === 'single'; }
  },
  
  // For class sessions
  activeQuestionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'QuizQuestion',
    default: null
  },
  questionsHistory: [{
    questionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'QuizQuestion'
    },
    broadcastedAt: Date
  }],
  
  // Timing
  duration: {
    type: Number,
    required: true,
    min: 10,
    max: 10800 // 3 hours max
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
  
  // Status: 'waiting' = students joined but no question yet, 'active' = question shown, 'expired' = ended
  status: {
    type: String,
    enum: ['waiting', 'active', 'expired'],
    default: 'waiting',
    index: true
  },
  
  // Creator
  createdBy: {
    type: String,
    required: true
  },
  createdByName: {
    type: String
  },
  
  // Course info
  courseId: {
    type: String,
    required: true
  },
  courseTitle: {
    type: String
  },
  
  // Students who joined (for class sessions)
  studentsJoined: [{
    email: String,
    name: String,
    joinedAt: Date
  }]
}, {
  timestamps: true
});

// Indexes
quizSessionSchema.index({ quizCode: 1, status: 1 });
quizSessionSchema.index({ expiresAt: 1 });
quizSessionSchema.index({ sessionType: 1, status: 1 });

// Check if expired
quizSessionSchema.methods.isExpired = function() {
  return Date.now() > this.expiresAt;
};

// Get remaining time
quizSessionSchema.methods.getRemainingTime = function() {
  const remaining = Math.floor((this.expiresAt - Date.now()) / 1000);
  return Math.max(0, remaining);
};

// Add student to session
quizSessionSchema.methods.addStudent = function(email, name) {
  const existing = this.studentsJoined.find(s => s.email === email);
  if (!existing) {
    this.studentsJoined.push({
      email,
      name,
      joinedAt: new Date()
    });
  }
};

// Broadcast question in class session
quizSessionSchema.methods.broadcastQuestion = async function(questionId) {
  if (this.sessionType !== 'class') {
    throw new Error('Can only broadcast in class sessions');
  }
  
  this.activeQuestionId = questionId;
  this.status = 'active';
  this.questionsHistory.push({
    questionId,
    broadcastedAt: new Date()
  });
  
  await this.save();
};

// Generate unique 6-digit code for single questions
quizSessionSchema.statics.generateUniqueCode = async function() {
  let code;
  let exists = true;
  
  while (exists) {
    code = Math.floor(100000 + Math.random() * 900000).toString();
    exists = await this.findOne({ quizCode: code, status: { $ne: 'expired' } });
  }
  
  return code;
};

// Generate unique class session code (CS_XXXXXX)
quizSessionSchema.statics.generateClassCode = async function() {
  let code;
  let exists = true;
  
  while (exists) {
    const num = Math.floor(100000 + Math.random() * 900000).toString();
    code = `CS_${num}`;
    exists = await this.findOne({ quizCode: code, status: { $ne: 'expired' } });
  }
  
  return code;
};

module.exports = mongoose.model('QuizSession', quizSessionSchema);