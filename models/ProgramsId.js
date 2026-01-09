// server/models/ProgramId.js
const mongoose = require('mongoose');

const ProgramIdSchema = new mongoose.Schema({
  // Store used IDs as strings like "P0001", "P0002"
  used: {
    type: [String],
    default: []
  }
}, {
  collection: 'program_ids'
});

module.exports = mongoose.model('ProgramId', ProgramIdSchema);