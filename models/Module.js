// server/models/Module.js
const mongoose = require('mongoose');

const moduleSchema = new mongoose.Schema({
  moduleId: { 
    type: String, 
    required: true, 
    unique: true, 
    trim: true, 
    index: true 
  }, // "M0001", "M0002", etc.
  
  programId: { 
    type: String, 
    required: true, 
    trim: true,
    index: true 
  }, // Reference to Program (e.g., "P0001")
  
  title: { 
    type: String, 
    required: true, 
    trim: true 
  },
  
  description: { 
    type: String, 
    default: '', 
    trim: true 
  },
  
  order: { 
    type: Number, 
    required: true, 
    default: 0 
  }, // Position within the program (0, 1, 2, ...)
  
  topicIds: [{ 
    type: String, 
    trim: true 
  }], // Array of topic IDs (e.g., ["0001", "0002"])
  
  // Tracking
  createdBy: { 
    type: String, 
    required: true, 
    trim: true 
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  },
  lastModifiedBy: { 
    type: String, 
    required: true, 
    trim: true 
  },
  lastModifiedAt: { 
    type: Date, 
    default: Date.now 
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
moduleSchema.index({ programId: 1, order: 1 });
moduleSchema.index({ programId: 1, moduleId: 1 });

// Instance method to check if a topic is in this module
moduleSchema.methods.hasTopic = function(topicId) {
  return this.topicIds.includes(topicId);
};

// Instance method to add a topic
moduleSchema.methods.addTopic = function(topicId) {
  if (!this.topicIds.includes(topicId)) {
    this.topicIds.push(topicId);
  }
};

// Instance method to remove a topic
moduleSchema.methods.removeTopic = function(topicId) {
  this.topicIds = this.topicIds.filter(id => id !== topicId);
};

// Static method to find all modules for a program
moduleSchema.statics.findByProgram = function(programId) {
  return this.find({ programId }).sort({ order: 1 });
};

module.exports = mongoose.model('Module', moduleSchema);