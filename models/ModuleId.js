// server/models/ModuleId.js
const mongoose = require('mongoose');

const moduleIdSchema = new mongoose.Schema({
  used: [{ type: String }] // Array of used module IDs: ["M0001", "M0002", ...]
});

module.exports = mongoose.model('ModuleId', moduleIdSchema);