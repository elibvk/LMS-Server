// server/models/QuizSubmission.js
const mongoose = require('mongoose');

const quizSubmissionSchema = new mongoose.Schema({
  quizSessionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'QuizSession',
    required: true,
    index: true
  },
  questionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'QuizQuestion',
    required: true,
    index: true
  },
  studentEmail: {
    type: String,
    required: true,
    index: true
  },
  studentName: {
    type: String,
    required: true
  },
  selectedOption: {
    type: Number,
    required: true,
    min: 0,
    max: 3
  },
  isCorrect: {
    type: Boolean,
    required: true
  },
  timeTaken: {
    type: Number, // seconds from broadcast to submission
    required: true
  },
  submittedAt: {
    type: Date,
    required: true,
    default: Date.now
  }
}, {
  timestamps: true
});

// Prevent duplicate submissions for same question in same session
quizSubmissionSchema.index({ 
  quizSessionId: 1, 
  questionId: 1, 
  studentEmail: 1 
}, { unique: true });

// Index for analytics
quizSubmissionSchema.index({ questionId: 1, isCorrect: 1 });

module.exports = mongoose.model('QuizSubmission', quizSubmissionSchema);