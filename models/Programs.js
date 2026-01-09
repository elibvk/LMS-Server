// server/models/Program.js
const mongoose = require('mongoose');

const collaboratorSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, trim: true },
  status: { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending' },
  addedBy: { type: String, required: true },
  addedAt: { type: Date, default: Date.now },
  acceptedAt: { type: Date, default: null },
  inviteToken: { type: String, default: null }
}, { _id: false });

const programSchema = new mongoose.Schema(
  {
    programId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    }, // "P0001"
    slug: { type: String, required: true }, // URL-friendly slug
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    thumbnail: { type: String, default: "", trim: true }, // URL to thumbnail image
    duration: { type: String, default: "", trim: true }, // e.g., "40 hours"
    difficulty: {
      type: String,
      enum: ["Beginner", "Intermediate", "Advanced"],
      default: "Beginner",
    },
    category: [{ type: String, trim: true }], // Array of category tags
    status: {
      type: String,
      enum: ["draft", "published"],
      default: "draft",
    },
    
    // ADD this field to programSchema
    modules: [
      {
        moduleId: { type: String, required: true },
        order: { type: Number, required: true },
      },
    ],

    // Array of topic IDs in order
    topicIds: [{ type: String, trim: true }],

    // Tracking
    createdBy: { type: String, required: true, trim: true },
    createdAt: { type: Date, default: Date.now },
    lastModifiedBy: { type: String, required: true, trim: true },
    lastModifiedAt: { type: Date, default: Date.now },

    // Collaborators
    collaborators: [collaboratorSchema],
  },
  {
    timestamps: true,
  }
);

// Indexes
programSchema.index({ title: 'text', description: 'text' });
programSchema.index({ createdBy: 1 });
programSchema.index({ 'collaborators.email': 1 });
programSchema.index({ status: 1 });
programSchema.index({ difficulty: 1 });
programSchema.index({ category: 1 });

// Permission helpers
// programSchema.methods.canEditContent = function(userEmail, userRole) {
//   if (userRole === 'super_admin') return true;
//   if (this.createdBy === userEmail) return true;
//   return this.collaborators.some(c => c.email === userEmail && c.status === 'accepted');
// };

// programSchema.methods.canEditInfo = function(userEmail, userRole) {
//   if (userRole === 'super_admin') return true;
//   if (this.createdBy === userEmail) return true;
//   return false;
// };

// programSchema.methods.canDelete = function(userEmail, userRole) {
//   if (userRole === 'super_admin') return true;
//   if (this.createdBy === userEmail) return true;
//   return false;
// };

programSchema.methods.canEditContent = function(userEmail, userRole) {
  // Allow all admins
  if (userRole === 'super_admin' || userRole === 'admin') return true;
  if (this.createdBy === userEmail) return true;
  return this.collaborators.some(c => c.email === userEmail && c.status === 'accepted');
};

programSchema.methods.canEditInfo = function(userEmail, userRole) {
  // Allow all admins
  if (userRole === 'super_admin' || userRole === 'admin') return true;
  if (this.createdBy === userEmail) return true;
  return false;
};

programSchema.methods.canDelete = function(userEmail, userRole) {
  // Allow all admins
  if (userRole === 'super_admin' || userRole === 'admin') return true;
  if (this.createdBy === userEmail) return true;
  return false;
};

// Static helper to find programs a user can access
programSchema.statics.findAccessibleByUser = function(userEmail, userRole) {
  if (userRole === 'super_admin') return this.find({});
  return this.find({
    $or: [
      { createdBy: userEmail },
      { 'collaborators.email': userEmail, 'collaborators.status': 'accepted' }
    ]
  });
};

module.exports = mongoose.model('Program', programSchema);