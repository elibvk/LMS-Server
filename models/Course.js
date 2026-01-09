const mongoose = require('mongoose');

const collaboratorSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, trim: true },
  status: { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending' },
  addedBy: { type: String, required: true },
  addedAt: { type: Date, default: Date.now },
  acceptedAt: { type: Date, default: null },
  inviteToken: { type: String, default: null }
}, { _id: false });

const courseSchema = new mongoose.Schema({
  projectId: { type: String, required: true, unique: true, trim: true, index: true },
  slug: { type: String, required: true },
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '', trim: true },
  keywords: [{ type: String, trim: true }],
  videoLink: { type: String, default: '', trim: true },

  // ⭐ NEW: Status field for draft/published
  status: { 
    type: String, 
    enum: ['draft', 'published'], 
    default: 'draft',
    index: true 
  },

  // Tracking
  createdBy: { type: String, required: true, trim: true },
  createdAt: { type: Date, default: Date.now },
  lastModifiedBy: { type: String, required: true, trim: true },
  lastModifiedAt: { type: Date, default: Date.now },

  // Collaborators
  collaborators: [collaboratorSchema],

  // File system sync status (optional)
  filesSynced: { type: Boolean, default: false },
  lastSyncedAt: { type: Date, default: null }
}, {
  timestamps: true
});

// Indexes
courseSchema.index({ title: 'text', description: 'text' });
courseSchema.index({ createdBy: 1 });
courseSchema.index({ 'collaborators.email': 1 });

// Permission helpers
courseSchema.methods.canEditContent = function(userEmail, userRole) {
  if (userRole === 'super_admin') return true;
  if (this.createdBy === userEmail) return true;
  return this.collaborators.some(c => c.email === userEmail && c.status === 'accepted');
};

courseSchema.methods.canEditInfo = function(userEmail, userRole) {
  if (userRole === 'super_admin') return true;
  if (this.createdBy === userEmail) return true;
  return false;
};

// ⭐ NEW: Permission to publish/unpublish
courseSchema.methods.canPublish = function(userEmail, userRole) {
  // Any admin can publish
  return userRole === 'super_admin' || userRole === 'admin';
};

// Static helper to find courses a user can access
courseSchema.statics.findAccessibleByUser = function(userEmail, userRole) {
  if (userRole === 'super_admin') return this.find({});
  return this.find({
    $or: [
      { createdBy: userEmail },
      { 'collaborators.email': userEmail, 'collaborators.status': 'accepted' }
    ]
  });
};

module.exports = mongoose.model('Course', courseSchema);