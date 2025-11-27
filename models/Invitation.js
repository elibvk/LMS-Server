const mongoose = require('mongoose');

// Collaboration Invitation Schema (for existing users)
const collaborationInvitationSchema = new mongoose.Schema({
  courseId: {
    type: String,
    required: true,
    index: true
  },
  courseTitle: {
    type: String,
    required: true
  },
  invitedEmail: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    index: true
  },
  invitedBy: {
    type: String,
    required: true
  },
  inviterName: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'declined', 'expired'],
    default: 'pending',
    index: true
  },
  token: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true
  },
  acceptedAt: {
    type: Date,
    default: null
  },
  declinedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Index for cleanup of expired invitations
collaborationInvitationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Pending User Invitation Schema (for non-registered users)
const pendingUserInvitationSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    index: true
  },
  courseId: {
    type: String,
    required: true,
    index: true
  },
  courseTitle: {
    type: String,
    required: true
  },
  invitedBy: {
    type: String,
    required: true
  },
  inviterName: {
    type: String,
    required: true
  },
  token: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'expired'],
    default: 'pending',
    index: true
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true
  },
  acceptedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Auto-expire after expiration date
pendingUserInvitationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const CollaborationInvitation = mongoose.model('CollaborationInvitation', collaborationInvitationSchema);
const PendingUserInvitation = mongoose.model('PendingUserInvitation', pendingUserInvitationSchema);

module.exports = {
  CollaborationInvitation,
  PendingUserInvitation
};