// models/QuizSubmission.js
const mongoose = require('mongoose');

const quizSubmissionSchema = new mongoose.Schema({
  quizSessionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'QuizSession',
    required: true,
    index: true
  },
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  selectedOption: {
    type: String,
    required: true
  },
  isCorrect: {
    type: Boolean,
    required: true
  },
  submittedAt: {
    type: Date,
    required: true,
    default: Date.now
  },
  timeTaken: {
    type: Number // seconds from start to submission
  }
}, {
  timestamps: true
});

// Prevent duplicate submissions
quizSubmissionSchema.index({ quizSessionId: 1, studentId: 1 }, { unique: true });

const QuizSubmission = mongoose.model('QuizSubmission', quizSubmissionSchema);

module.exports = QuizSubmission;