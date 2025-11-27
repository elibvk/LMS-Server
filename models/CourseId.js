// server/models/CourseId.js
const mongoose = require('mongoose');

const CourseIdSchema = new mongoose.Schema({
  // store used ids as strings like "0001", "0002"
  used: {
    type: [String],
    default: []
  }
}, {
  collection: 'course_ids'
});

module.exports = mongoose.model('CourseId', CourseIdSchema);
