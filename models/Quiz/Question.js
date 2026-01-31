// server/models/Quiz/Question.js
const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema({
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
  explanation: {
    type: String,
    required: true
  },
  difficulty: {
    type: String,
    enum: ['easy', 'medium', 'hard'],
    default: 'medium'
  },
  source: {
    type: String,
    enum: ['content', 'url'],
    required: true
  },
  sourceContent: {
    type: String,
    required: true
  },
  createdBy: {
    type: String, // Admin email
    required: true
  },
  usageCount: {
    type: Number,
    default: 0
  },
  lastUsedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Compound index for efficient queries
questionSchema.index({ courseId: 1, createdAt: -1 });

// Method to increment usage
questionSchema.methods.incrementUsage = async function() {
  this.usageCount += 1;
  this.lastUsedAt = new Date();
  await this.save();
};

const Question = mongoose.model('Question', questionSchema);

module.exports = Question;