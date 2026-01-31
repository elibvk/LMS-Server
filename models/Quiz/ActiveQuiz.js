// server/models/ActiveQuiz.js
const mongoose = require('mongoose');

const submissionSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  studentEmail: {
    type: String,
    required: true
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
  submittedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const activeQuizSchema = new mongoose.Schema({
  courseId: {
    type: String,
    required: true,
    unique: true, // Only one active quiz per course
    index: true
  },
  questionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Question',
    required: true
  },
  // Denormalized question data (for quick access)
  question: {
    type: String,
    required: true
  },
  options: {
    type: [String],
    required: true
  },
  correctAnswer: {
    type: Number,
    required: true
  },
  explanation: {
    type: String,
    required: true
  },
  activatedBy: {
    type: String, // Teacher email
    required: true
  },
  activatedAt: {
    type: Date,
    default: Date.now
  },
  submissionCount: {
    type: Number,
    default: 0
  },
  correctCount: {
    type: Number,
    default: 0
  },
  submissions: [submissionSchema]
}, {
  timestamps: true
});

// Check if student already submitted
activeQuizSchema.methods.hasStudentSubmitted = function(studentId) {
  return this.submissions.some(
    sub => sub.studentId.toString() === studentId.toString()
  );
};

// Add submission
activeQuizSchema.methods.addSubmission = async function(submission) {
  this.submissions.push(submission);
  this.submissionCount += 1;
  if (submission.isCorrect) {
    this.correctCount += 1;
  }
  await this.save();
};

const ActiveQuiz = mongoose.model('ActiveQuiz', activeQuizSchema);

module.exports = ActiveQuiz;