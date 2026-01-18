// server/models/QuizQuestion.js
const mongoose = require('mongoose');

const quizQuestionSchema = new mongoose.Schema({
  courseId: {
    type: String,
    required: true,
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
    type: Number,
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
  createdBy: {
    type: String,
    required: true
  },
  createdByName: {
    type: String
  },
  timesUsed: {
    type: Number,
    default: 0
  },
  lastUsedAt: {
    type: Date,
    default: null
  },
  // Track if this question is currently active in any session
  isActiveInSession: {
    type: Boolean,
    default: false
  },
  activeSessionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'QuizSession',
    default: null
  }
}, {
  timestamps: true
});

// Indexes for performance
quizQuestionSchema.index({ courseId: 1, createdAt: -1 });
quizQuestionSchema.index({ courseId: 1, lastUsedAt: -1 });
quizQuestionSchema.index({ isActiveInSession: 1 });

// Method to mark question as used
quizQuestionSchema.methods.markAsUsed = async function() {
  this.timesUsed += 1;
  this.lastUsedAt = new Date();
  await this.save();
};

// Method to activate in session
quizQuestionSchema.methods.activateInSession = async function(sessionId) {
  this.isActiveInSession = true;
  this.activeSessionId = sessionId;
  await this.save();
};

// Method to deactivate from session
quizQuestionSchema.methods.deactivateFromSession = async function() {
  this.isActiveInSession = false;
  this.activeSessionId = null;
  await this.save();
};

// Static method: Get available questions for a course
quizQuestionSchema.statics.getAvailableForCourse = function(courseId) {
  return this.find({ 
    courseId,
    isActiveInSession: false 
  }).sort({ lastUsedAt: 1, createdAt: -1 });
};

module.exports = mongoose.model('QuizQuestion', quizQuestionSchema);