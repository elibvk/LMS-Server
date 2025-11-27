const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const Course = require('../models/Course');

const router = express.Router();

// Helper: Load invites
async function loadInvites() {
  const invitesPath = path.join(__dirname, '../data/collaboration_invites.json');
  try {
    const content = await fs.readFile(invitesPath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    return [];
  }
}

// Helper: Save invites
async function saveInvites(invites) {
  const invitesPath = path.join(__dirname, '../data/collaboration_invites.json');
  const dataDir = path.join(__dirname, '../data');
  
  try {
    await fs.access(dataDir);
  } catch {
    await fs.mkdir(dataDir, { recursive: true });
  }
  
  await fs.writeFile(invitesPath, JSON.stringify(invites, null, 2));
}

// Helper: Update index.json for backward compatibility
async function updateIndexJson() {
  try {
    const docsDir = path.join(__dirname, '../../client/public/docs');
    const indexPath = path.join(docsDir, 'index.json');
    
    const courses = await Course.find({}).sort({ projectId: 1 });
    
    const indexData = courses.map(course => ({
      proj: course.projectId,
      title: course.title,
      description: course.description,
      keywords: course.keywords,
      createdBy: course.createdBy,
      createdAt: course.createdAt,
      lastModifiedBy: course.lastModifiedBy,
      lastModifiedAt: course.lastModifiedAt,
      collaborators: course.collaborators
    }));
    
    await fs.writeFile(indexPath, JSON.stringify(indexData, null, 2));
    return true;
  } catch (error) {
    console.error('Error updating index.json:', error);
    return false;
  }
}

// GET /api/invites/:token
router.get('/:token', async (req, res) => {
  try {
    const { token } = req.params;
    
    const invites = await loadInvites();
    const invite = invites.find(inv => inv.token === token && inv.status === 'pending');
    
    if (!invite) {
      return res.status(404).json({ error: 'Invitation not found or already used' });
    }
    
    // Check if expired
    if (new Date(invite.expiresAt) < new Date()) {
      return res.status(400).json({ error: 'This invitation has expired' });
    }
    
    res.json({
      courseId: invite.courseId,
      courseTitle: invite.courseTitle,
      invitedBy: invite.inviterName,
      invitedEmail: invite.invitedEmail,
      expiresAt: invite.expiresAt
    });
    
  } catch (error) {
    console.error('Error getting invite:', error);
    res.status(500).json({ error: 'Failed to get invitation details' });
  }
});

// POST /api/invites/:token/accept
router.post('/:token/accept', async (req, res) => {
  try {
    const { token } = req.params;
    const { email } = req.body;
    
    const invites = await loadInvites();
    const inviteIndex = invites.findIndex(inv => inv.token === token && inv.status === 'pending');
    
    if (inviteIndex === -1) {
      return res.status(404).json({ error: 'Invitation not found or already used' });
    }
    
    const invite = invites[inviteIndex];
    
    // Check if expired
    if (new Date(invite.expiresAt) < new Date()) {
      return res.status(400).json({ error: 'This invitation has expired' });
    }
    
    // Verify email matches
    if (email && email.toLowerCase() !== invite.invitedEmail.toLowerCase()) {
      return res.status(403).json({ error: 'This invitation is for a different email address' });
    }
    
    // Update course collaborator status to 'accepted' in MongoDB
    const course = await Course.findOne({ projectId: invite.courseId });
    
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    const collabIndex = course.collaborators.findIndex(
      c => c.email === invite.invitedEmail && c.inviteToken === token
    );
    
    if (collabIndex === -1) {
      return res.status(404).json({ error: 'Collaborator record not found' });
    }
    
    // Update status to accepted
    course.collaborators[collabIndex].status = 'accepted';
    course.collaborators[collabIndex].acceptedAt = new Date();
    delete course.collaborators[collabIndex].inviteToken;
    
    await course.save();
    
    // Update index.json
    await updateIndexJson();
    
    // Mark invite as accepted
    invites[inviteIndex].status = 'accepted';
    invites[inviteIndex].acceptedAt = new Date().toISOString();
    await saveInvites(invites);
    
    console.log(`✅ Collaboration accepted: ${invite.invitedEmail} for course ${invite.courseId}`);
    
    res.json({ 
      success: true, 
      message: 'Invitation accepted successfully!',
      courseId: invite.courseId,
      courseTitle: invite.courseTitle
    });
    
  } catch (error) {
    console.error('Error accepting invite:', error);
    res.status(500).json({ error: 'Failed to accept invitation' });
  }
});

// POST /api/invites/:token/decline
router.post('/:token/decline', async (req, res) => {
  try {
    const { token } = req.params;
    
    const invites = await loadInvites();
    const inviteIndex = invites.findIndex(inv => inv.token === token && inv.status === 'pending');
    
    if (inviteIndex === -1) {
      return res.status(404).json({ error: 'Invitation not found or already used' });
    }
    
    const invite = invites[inviteIndex];
    
    // Remove collaborator from course in MongoDB
    const course = await Course.findOne({ projectId: invite.courseId });
    
    if (course) {
      course.collaborators = course.collaborators.filter(
        c => !(c.email === invite.invitedEmail && c.inviteToken === token)
      );
      await course.save();
      
      // Update index.json
      await updateIndexJson();
    }
    
    // Mark invite as declined
    invites[inviteIndex].status = 'declined';
    invites[inviteIndex].declinedAt = new Date().toISOString();
    await saveInvites(invites);
    
    console.log(`❌ Collaboration declined: ${invite.invitedEmail} for course ${invite.courseId}`);
    
    res.json({ success: true, message: 'Invitation declined' });
    
  } catch (error) {
    console.error('Error declining invite:', error);
    res.status(500).json({ error: 'Failed to decline invitation' });
  }
});

module.exports = router;