const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { verifyAdmin } = require('../middleware/auth');
const { checkContentEditAccess, checkInfoEditAccess, isRegisteredUser } = require('../middleware/courseAccess');
const multer = require('multer');
const crypto = require('crypto');
const { sendEmail } = require('../utils/email');
const router = express.Router();
const storage = multer.memoryStorage();
const upload = multer({ storage });
const User = require('../models/User');

// Helper: Load collaboration invites
async function loadInvites() {
  const invitesPath = path.join(__dirname, '../data/collaboration_invites.json');
  try {
    const content = await fs.readFile(invitesPath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    return [];
  }
}

// Helper: Save collaboration invites
async function saveInvites(invites) {
  const invitesPath = path.join(__dirname, '../data/collaboration_invites.json');
  const dataDir = path.join(__dirname, '../data');
  
  // Create data directory if it doesn't exist
  try {
    await fs.access(dataDir);
  } catch {
    await fs.mkdir(dataDir, { recursive: true });
  }
  
  await fs.writeFile(invitesPath, JSON.stringify(invites, null, 2));
}

// Helper: Generate course ID from title
function generateCourseId(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 50);
}

// Helper: Generate _sidebar.md from README headers
function generateSidebar(readmeContent) {
  const lines = readmeContent.split('\n');
  const headers = [];

  for (const line of lines) {
    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) {
      const title = h2Match[1].trim();
      const anchor = title
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-');
      headers.push(`* [${title}](README.md#${anchor})`);
    }
  }

  return headers.length > 0 ? headers.join('\n') : '* [Home](README.md)';
}

// Helper: Generate index.html
function generateIndexHtml(title) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="//cdn.jsdelivr.net/npm/docsify@4/lib/themes/vue.css">
</head>
<body>
  <div id="app">Loading...</div>

  <script>
    window.$docsify = {
      name: '${title}',
      repo: '',
      loadSidebar: true,
      subMaxLevel: 2,
      loadNavbar: false,
      copyCode: {
        buttonText: '📋 Copy',
        errorText: '✖ Failed',
        successText: '✓ Copied!'
      },
    };
  </script>

  <script src="//cdn.jsdelivr.net/npm/docsify@4"></script>
  <script src="//cdn.jsdelivr.net/npm/docsify-copy-code"></script>
</body>
</html>`;
}

// Helper: Update index.json with full metadata tracking
async function updateIndexJson(docsDir, courseId, title, description, keywords = [], adminEmail, isUpdate = false) {
  const indexPath = path.join(docsDir, 'index.json');
  
  let courses = [];
  try {
    const content = await fs.readFile(indexPath, 'utf-8');
    courses = JSON.parse(content);
  } catch (err) {
    console.log('Creating new index.json');
  }

  const existing = courses.findIndex(c => c.proj === courseId);
  const now = new Date().toISOString();
  
  let courseData;
  
  if (existing >= 0 && isUpdate) {
    // Update existing course - preserve creation info and collaborators
    courseData = {
      ...courses[existing],
      title,
      description,
      keywords: Array.isArray(keywords) ? keywords : (keywords ? keywords.split(',').map(k => k.trim()).filter(Boolean) : []),
      lastModifiedBy: adminEmail,
      lastModifiedAt: now
    };
    courses[existing] = courseData;
  } else if (existing >= 0) {
    // Replace existing (shouldn't happen in normal flow)
    courseData = {
      proj: courseId,
      title,
      description,
      keywords: Array.isArray(keywords) ? keywords : (keywords ? keywords.split(',').map(k => k.trim()).filter(Boolean) : []),
      createdBy: courses[existing].createdBy || adminEmail,
      createdAt: courses[existing].createdAt || now,
      lastModifiedBy: adminEmail,
      lastModifiedAt: now,
      collaborators: courses[existing].collaborators || []
    };
    courses[existing] = courseData;
  } else {
    // New course
    courseData = {
      proj: courseId,
      title,
      description,
      keywords: Array.isArray(keywords) ? keywords : (keywords ? keywords.split(',').map(k => k.trim()).filter(Boolean) : []),
      createdBy: adminEmail,
      createdAt: now,
      lastModifiedBy: adminEmail,
      lastModifiedAt: now,
      collaborators: []
    };
    courses.push(courseData);
  }

  courses.sort((a, b) => a.proj.localeCompare(b.proj));
  await fs.writeFile(indexPath, JSON.stringify(courses, null, 2));
}

// Helper: Load pending user invitations from JSON file
async function loadPendingUserInvitations() {
  const invitesPath = path.join(__dirname, '../data/pending_user_invitations.json');
  try {
    const content = await fs.readFile(invitesPath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    return [];
  }
}

// Helper: Save pending user invitations
async function savePendingUserInvitations(invitations) {
  const invitesPath = path.join(__dirname, '../data/pending_user_invitations.json');
  const dataDir = path.join(__dirname, '../data');
  
  try {
    await fs.access(dataDir);
  } catch {
    await fs.mkdir(dataDir, { recursive: true });
  }
  
  await fs.writeFile(invitesPath, JSON.stringify(invitations, null, 2));
}
// POST /api/courses/create
router.post('/create', verifyAdmin, async (req, res) => {
  try {
    // Use multer to handle multipart form data
    const uploadMultiple = upload.fields([
      { name: 'readme', maxCount: 1 },
      { name: 'images', maxCount: 10 }
    ]);

    uploadMultiple(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ error: 'File upload error: ' + err.message });
      }

      const { title, description, keywords } = req.body;

      if (!title) {
        return res.status(400).json({ error: 'Title is required' });
      }

      const courseId = generateCourseId(title);
      const docsDir = path.join(__dirname, '../../client/public/docs');
      const courseDir = path.join(docsDir, courseId);

      // Check if course already exists
      try {
        await fs.access(courseDir);
        return res.status(400).json({ error: 'Course with this title already exists' });
      } catch (err) {
        // Course doesn't exist, continue
      }

      // Create course directory
      await fs.mkdir(courseDir, { recursive: true });

      // Handle README
      let readmeContent = `# ${title}\n\nStart writing your course content here...\n`;
      
      if (req.files && req.files['readme'] && req.files['readme'][0]) {
        readmeContent = req.files['readme'][0].buffer.toString('utf-8');
      }

      // Generate sidebar and index
      const sidebarContent = generateSidebar(readmeContent);
      const indexContent = generateIndexHtml(title);

      // Write files
      await fs.writeFile(path.join(courseDir, 'README.md'), readmeContent);
      await fs.writeFile(path.join(courseDir, '_sidebar.md'), sidebarContent);
      await fs.writeFile(path.join(courseDir, 'index.html'), indexContent);

      // Update index.json
      await updateIndexJson(docsDir, courseId, title, description || '', keywords || '', req.admin.email, false);

      // Handle images if provided
      if (req.files && req.files['images'] && req.files['images'].length > 0) {
        const imagesDir = path.join(__dirname, '../../client/public/docs', courseId, 'images');
        await fs.mkdir(imagesDir, { recursive: true });

        for (const imageFile of req.files['images']) {
          const imagePath = path.join(imagesDir, `${Date.now()}-${imageFile.originalname}`);
          await fs.writeFile(imagePath, imageFile.buffer);
        }

        console.log(`✅ ${req.files['images'].length} image(s) uploaded for new course ${courseId}`);
      }

      console.log(`✅ Course created: ${courseId} by ${req.admin.email}`);

      res.json({
        success: true,
        message: 'Course created successfully',
        course: { id: courseId, title, description, keywords }
      });
    });

  } catch (error) {
    console.error('Error creating course:', error);
    res.status(500).json({ error: 'Failed to create course: ' + error.message });
  }
});

// GET /api/courses
router.get('/', async (req, res) => {
  try {
    const docsDir = path.join(__dirname, '../../client/public/docs');
    const indexPath = path.join(docsDir, 'index.json');

    const content = await fs.readFile(indexPath, 'utf-8');
    const courses = JSON.parse(content);

    res.json({ courses });
  } catch (error) {
    console.error('Error fetching courses:', error);
    res.status(500).json({ error: 'Failed to fetch courses' });
  }
});

// GET /api/courses/:id
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const docsDir = path.join(__dirname, '../../client/public/docs');
    const readmePath = path.join(docsDir, id, 'README.md');

    const content = await fs.readFile(readmePath, 'utf-8');

    res.json({ success: true, content });
  } catch (error) {
    console.error('Error reading course:', error);
    res.status(500).json({ error: 'Failed to read course content' });
  }
});

// GET /api/courses/:id/permissions
// Check current user's permissions for a course
router.get('/:id/permissions', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const userEmail = req.admin.email;
    const userRole = req.admin.role;
    
    const docsDir = path.join(__dirname, '../../client/public/docs');
    const indexPath = path.join(docsDir, 'index.json');
    
    const content = await fs.readFile(indexPath, 'utf-8');
    const courses = JSON.parse(content);
    const course = courses.find(c => c.proj === id);
    
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    const isSuperAdmin = userRole === 'super_admin';
    const isAuthor = course.createdBy === userEmail;
    const isCollaborator = course.collaborators?.some(
      c => c.email === userEmail && c.status === 'accepted'
    );
    
    res.json({
      canView: true,
      canEditContent: isSuperAdmin || isAuthor || isCollaborator,
      canEditInfo: isSuperAdmin || isAuthor,
      canManageCollaborators: isSuperAdmin || isAuthor,
      canDelete: isSuperAdmin || isAuthor,
      isAuthor,
      isCollaborator,
      isSuperAdmin
    });
    
  } catch (error) {
    console.error('Error checking permissions:', error);
    res.status(500).json({ error: 'Failed to check permissions' });
  }
});

// GET /api/courses/:id/info
router.get('/:id/info', async (req, res) => {
  try {
    const { id } = req.params;
    const docsDir = path.join(__dirname, '../../client/public/docs');
    const indexPath = path.join(docsDir, 'index.json');
    
    const content = await fs.readFile(indexPath, 'utf-8');
    const courses = JSON.parse(content);
    const course = courses.find(c => c.proj === id);
    
    if (!course) {
      return res.status(404).json({ error: 'Course not found in index.json' });
    }
    
    res.json({
      course: {
        title: course.title || '',
        description: course.description || '',
        keywords: course.keywords ? (Array.isArray(course.keywords) ? course.keywords : course.keywords.split(',').map(k => k.trim())) : [],
        createdBy: course.createdBy || 'Unknown',
        createdAt: course.createdAt || new Date().toISOString(),
        lastModifiedBy: course.lastModifiedBy || course.createdBy || 'Unknown',
        lastModifiedAt: course.lastModifiedAt || course.createdAt || new Date().toISOString(),
        collaborators: course.collaborators || []
      }
    });
    
  } catch (error) {
    console.error('Error getting course info:', error);
    res.status(500).json({ error: 'Failed to get course info' });
  }
});

// PUT /api/courses/:id/info
// Update course info (author and super admin only)
router.put('/:id/info', verifyAdmin, checkInfoEditAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, keywords } = req.body;
    
    const docsDir = path.join(__dirname, '../../client/public/docs');
    const indexPath = path.join(docsDir, 'index.json');
    
    let courses = [];
    try {
      const content = await fs.readFile(indexPath, 'utf-8');
      courses = JSON.parse(content);
    } catch (err) {
      return res.status(500).json({ error: 'Failed to read index.json' });
    }
    
    const courseIndex = courses.findIndex(c => c.proj === id);
    if (courseIndex === -1) {
      return res.status(404).json({ error: 'Course not found in index.json' });
    }
    
    const existingCourse = courses[courseIndex];
    const now = new Date().toISOString();
    
    courses[courseIndex] = {
      ...existingCourse,
      title: title || existingCourse.title,
      description: description || '',
      keywords: Array.isArray(keywords) ? keywords : (keywords ? keywords.split(',').map(k => k.trim()) : []),
      lastModifiedBy: req.admin.email,
      lastModifiedAt: now
    };
    
    await fs.writeFile(indexPath, JSON.stringify(courses, null, 2));
    
    console.log(`✅ Course info updated: ${id} by ${req.admin.email}`);
    
    res.json({ success: true, message: 'Course info updated' });
    
  } catch (error) {
    console.error('Error updating course info:', error);
    res.status(500).json({ error: 'Failed to update course info' });
  }
});

// POST /api/courses/:id/collaborators
// Add a collaborator (author and super admin only)
router.post('/:id/collaborators', verifyAdmin, checkInfoEditAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const { email } = req.body;
    
    if (!email || !email.trim()) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    const collaboratorEmail = email.trim().toLowerCase();
    
    // Check if trying to add themselves
    if (collaboratorEmail === req.admin.email) {
      return res.status(400).json({ error: 'You cannot add yourself as a collaborator' });
    }
    
    const docsDir = path.join(__dirname, '../../client/public/docs');
    const indexPath = path.join(docsDir, 'index.json');
    
    // Load courses
    const content = await fs.readFile(indexPath, 'utf-8');
    const courses = JSON.parse(content);
    const courseIndex = courses.findIndex(c => c.proj === id);
    
    if (courseIndex === -1) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    const course = courses[courseIndex];
    
    // Check if already a collaborator
    const existingCollab = course.collaborators?.find(c => c.email === collaboratorEmail);
    if (existingCollab) {
      return res.status(400).json({ 
        error: `${collaboratorEmail} is already a collaborator (status: ${existingCollab.status})` 
      });
    }
    
    // ===== NEW: Check if user exists in User collection =====
    const existingUser = await User.findOne({ email: collaboratorEmail });
    
    if (existingUser) {
      // USER EXISTS - Add directly as collaborator with pending status
      const token = crypto.randomBytes(32).toString('hex');
      const now = new Date().toISOString();
      
      if (!course.collaborators) course.collaborators = [];
      course.collaborators.push({
        email: collaboratorEmail,
        status: 'pending',
        addedBy: req.admin.email,
        addedAt: now,
        inviteToken: token
      });
      
      courses[courseIndex] = course;
      await fs.writeFile(indexPath, JSON.stringify(courses, null, 2));
      
      // Create invitation record for existing user
      const invites = await loadInvites();
      invites.push({
        id: `invite_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        courseId: id,
        courseTitle: course.title,
        invitedEmail: collaboratorEmail,
        invitedBy: req.admin.email,
        inviterName: req.admin.name,
        status: 'pending',
        token,
        createdAt: now,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      });
      await saveInvites(invites);
      
      // Send notification email to existing user
      const acceptLink = `${process.env.CLIENT_URL}/invite/accept?token=${token}`;
      
      await sendEmail({
        to: collaboratorEmail,
        subject: `Collaboration Invitation: ${course.title}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #646cff;">Course Collaboration Invitation</h2>
            <p>Hello ${existingUser.name},</p>
            <p><strong>${req.admin.name}</strong> (${req.admin.email}) has invited you to collaborate on the course:</p>
            <h3 style="color: #333;">${course.title}</h3>
            ${course.description ? `<p style="color: #666;">${course.description}</p>` : ''}
            <p>As a collaborator, you will be able to:</p>
            <ul>
              <li>✅ Edit course content</li>
              <li>✅ Upload and modify README files</li>
              <li>✅ Update course materials</li>
            </ul>
            <p>Click the button below to accept this invitation:</p>
            <a href="${acceptLink}" 
               style="display: inline-block; padding: 12px 24px; background: #646cff; color: white; text-decoration: none; border-radius: 8px; margin: 20px 0;">
              Accept Invitation
            </a>
            <p style="color: #666; font-size: 12px;">This invitation expires in 7 days.</p>
          </div>
        `
      });
      
      console.log(`✅ Collaboration invite sent to existing user ${collaboratorEmail} for course ${id}`);
      
      return res.json({ 
        success: true, 
        message: `Invitation sent to ${collaboratorEmail}`,
        userExists: true,
        collaborator: {
          email: collaboratorEmail,
          status: 'pending',
          addedAt: now
        }
      });
      
    } else {
      // USER DOESN'T EXIST - Create pending invitation for registration
      const inviteToken = crypto.randomBytes(32).toString('hex');
      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      
      // Check if invitation already exists
      const pendingInvites = await loadPendingUserInvitations();
      const existingInvite = pendingInvites.find(
        inv => inv.email === collaboratorEmail && inv.courseId === id && inv.status === 'pending'
      );
      
      if (existingInvite) {
        return res.status(400).json({ error: 'Invitation already sent to this email' });
      }
      
      // Create pending user invitation
      pendingInvites.push({
        id: `user_invite_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        email: collaboratorEmail,
        courseId: id,
        courseTitle: course.title,
        invitedBy: req.admin.email,
        inviterName: req.admin.name,
        token: inviteToken,
        createdAt: now,
        expiresAt: expiresAt,
        status: 'pending'
      });
      await savePendingUserInvitations(pendingInvites);
      
      // Send registration invitation email
      const registerLink = `${process.env.CLIENT_URL}/register?invite=${inviteToken}`;
      
      await sendEmail({
        to: collaboratorEmail,
        subject: `You're invited to collaborate on "${course.title}"`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #646cff;">🎓 Course Collaboration Invitation</h2>
            <p>Hello!</p>
            <p><strong>${req.admin.name}</strong> has invited you to collaborate on the course:</p>
            <h3 style="color: #333;">${course.title}</h3>
            ${course.description ? `<p style="color: #666;">${course.description}</p>` : ''}
            <p>As a collaborator, you will be able to edit course content and materials.</p>
            <p><strong>To accept this invitation, you need to create a LearnHub account first:</strong></p>
            <a href="${registerLink}" 
               style="display: inline-block; padding: 12px 24px; background: #667eea; color: white; text-decoration: none; border-radius: 8px; margin: 20px 0;">
              Create Account & Accept Invitation
            </a>
            <p style="color: #666; font-size: 12px;">This invitation expires in 7 days.</p>
            <p style="color: #666; font-size: 12px;">If you're not interested, you can safely ignore this email.</p>
          </div>
        `
      });
      
      console.log(`✅ Registration invitation sent to ${collaboratorEmail} for course ${id}`);
      
      return res.json({ 
        success: true, 
        message: `Invitation sent to ${collaboratorEmail}. They need to register first.`,
        userExists: false,
        requiresRegistration: true
      });
    }
    
  } catch (error) {
    console.error('Error adding collaborator:', error);
    res.status(500).json({ error: 'Failed to add collaborator: ' + error.message });
  }
});

// GET /api/courses/:id/pending-user-invitations
// Get pending user registration invitations for a course (author only)
router.get('/:id/pending-user-invitations', verifyAdmin, checkInfoEditAccess, async (req, res) => {
  try {
    const { id } = req.params;
    
    const pendingInvites = await loadPendingUserInvitations();
    const courseInvites = pendingInvites.filter(
      inv => inv.courseId === id && inv.status === 'pending' && new Date(inv.expiresAt) > new Date()
    );
    
    res.json({ invitations: courseInvites });
    
  } catch (error) {
    console.error('Error fetching pending user invitations:', error);
    res.status(500).json({ error: 'Failed to fetch invitations' });
  }
});

// DELETE /api/courses/:id/pending-user-invitations/:email
// Cancel a pending user invitation (author only)
router.delete('/:id/pending-user-invitations/:email', verifyAdmin, checkInfoEditAccess, async (req, res) => {
  try {
    const { id, email } = req.params;
    
    const pendingInvites = await loadPendingUserInvitations();
    const filteredInvites = pendingInvites.filter(
      inv => !(inv.courseId === id && inv.email === decodeURIComponent(email) && inv.status === 'pending')
    );
    
    if (filteredInvites.length === pendingInvites.length) {
      return res.status(404).json({ error: 'Invitation not found' });
    }
    
    await savePendingUserInvitations(filteredInvites);
    
    console.log(`✅ Pending user invitation cancelled for ${email} on course ${id}`);
    
    res.json({ success: true, message: 'Invitation cancelled' });
    
  } catch (error) {
    console.error('Error cancelling invitation:', error);
    res.status(500).json({ error: 'Failed to cancel invitation' });
  }
});

// GET /api/courses/invitations/verify/:token
// Verify invitation token is valid
router.get('/invitations/verify/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const invitations = await loadPendingUserInvitations();
    const invitation = invitations.find(
      inv => inv.token === token && inv.status === 'pending' && new Date(inv.expiresAt) > new Date()
    );

    if (!invitation) {
      return res.status(404).json({ 
        valid: false, 
        error: 'Invalid or expired invitation' 
      });
    }

    res.json({
      valid: true,
      email: invitation.email,
      courseName: invitation.courseTitle,
      invitedBy: invitation.inviterName,
      courseId: invitation.courseId
    });

  } catch (error) {
    console.error('Error verifying invitation:', error);
    res.status(500).json({ error: 'Failed to verify invitation' });
  }
});

// POST /api/courses/invitations/accept
// Called after user registers with invite token
router.post('/invitations/accept', verifyAdmin, async (req, res) => {
  try {
    const { token } = req.body;
    const userEmail = req.admin.email;

    // Find the invitation
    const invitations = await loadPendingUserInvitations();
    const inviteIndex = invitations.findIndex(
      inv => inv.token === token && inv.email === userEmail && inv.status === 'pending' && new Date(inv.expiresAt) > new Date()
    );

    if (inviteIndex === -1) {
      return res.status(404).json({ error: 'Invalid or expired invitation' });
    }

    const invitation = invitations[inviteIndex];

    // Add user as collaborator to the course
    const docsDir = path.join(__dirname, '../../client/public/docs');
    const indexPath = path.join(docsDir, 'index.json');
    
    const content = await fs.readFile(indexPath, 'utf-8');
    const courses = JSON.parse(content);
    const courseIndex = courses.findIndex(c => c.proj === invitation.courseId);
    
    if (courseIndex === -1) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    const course = courses[courseIndex];
    if (!course.collaborators) course.collaborators = [];
    
    // Check if already added
    const existingCollab = course.collaborators.find(c => c.email === userEmail);
    if (!existingCollab) {
      course.collaborators.push({
        email: userEmail,
        addedBy: invitation.invitedBy,
        addedAt: new Date().toISOString(),
        status: 'accepted'
      });
      
      courses[courseIndex] = course;
      await fs.writeFile(indexPath, JSON.stringify(courses, null, 2));
    }

    // Mark invitation as accepted
    invitations[inviteIndex].status = 'accepted';
    invitations[inviteIndex].acceptedAt = new Date().toISOString();
    await savePendingUserInvitations(invitations);

    // Notify course author
    await sendEmail({
      to: invitation.invitedBy,
      subject: `${userEmail} accepted your collaboration invitation`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #646cff;">✅ Collaborator Accepted</h2>
          <p>Good news!</p>
          <p><strong>${userEmail}</strong> has accepted your invitation and is now a collaborator on:</p>
          <h3 style="color: #333;">${invitation.courseTitle}</h3>
          <p>They can now start editing the course content.</p>
        </div>
      `
    });

    console.log(`✅ User ${userEmail} accepted invitation for course ${invitation.courseId}`);

    res.json({ 
      success: true, 
      message: 'Successfully added as collaborator',
      courseId: invitation.courseId
    });

  } catch (error) {
    console.error('Error accepting invitation:', error);
    res.status(500).json({ error: 'Failed to accept invitation' });
  }
});

// DELETE /api/courses/:id/collaborators/:email
// Remove a collaborator (author and super admin only)
router.delete('/:id/collaborators/:email', verifyAdmin, checkInfoEditAccess, async (req, res) => {
  try {
    const { id, email } = req.params;
    
    const docsDir = path.join(__dirname, '../../client/public/docs');
    const indexPath = path.join(docsDir, 'index.json');
    
    const content = await fs.readFile(indexPath, 'utf-8');
    const courses = JSON.parse(content);
    const courseIndex = courses.findIndex(c => c.proj === id);
    
    if (courseIndex === -1) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    const course = courses[courseIndex];
    
    // Remove collaborator
    const originalLength = course.collaborators?.length || 0;
    course.collaborators = course.collaborators?.filter(c => c.email !== email) || [];
    
    if (course.collaborators.length === originalLength) {
      return res.status(404).json({ error: 'Collaborator not found' });
    }
    
    courses[courseIndex] = course;
    await fs.writeFile(indexPath, JSON.stringify(courses, null, 2));
    
    // Remove pending invite if exists
    const invites = await loadInvites();
    const updatedInvites = invites.filter(inv => 
      !(inv.courseId === id && inv.invitedEmail === email && inv.status === 'pending')
    );
    await saveInvites(updatedInvites);
    
    console.log(`✅ Collaborator ${email} removed from course ${id}`);
    
    res.json({ success: true, message: 'Collaborator removed' });
    
  } catch (error) {
    console.error('Error removing collaborator:', error);
    res.status(500).json({ error: 'Failed to remove collaborator' });
  }
});

// GET /api/courses/:id/download
router.get('/:id/download', async (req, res) => {
  try {
    const { id } = req.params;
    const docsDir = path.join(__dirname, '../../client/public/docs');
    const readmePath = path.join(docsDir, id, 'README.md');

    try {
      await fs.access(readmePath);
    } catch (err) {
      return res.status(404).json({ error: 'README file not found' });
    }

    res.download(readmePath, `${id}_README.md`, (err) => {
      if (err) {
        console.error('Error downloading file:', err);
        res.status(500).json({ error: 'Failed to download file' });
      }
    });

  } catch (error) {
    console.error('Error downloading README:', error);
    res.status(500).json({ error: 'Failed to download README' });
  }
});

// POST /api/courses/:id/upload-readme
// Upload README (author, collaborators, super admin)
router.post('/:id/upload-readme', verifyAdmin, checkContentEditAccess, upload.single('readme'), async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const docsDir = path.join(__dirname, '../../client/public/docs');
    const courseDir = path.join(docsDir, id);
    const readmePath = path.join(courseDir, 'README.md');
    const indexPath = path.join(docsDir, 'index.json');
    
    try {
      await fs.access(courseDir);
    } catch (err) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    const content = req.file.buffer.toString('utf-8');
    await fs.writeFile(readmePath, content);
    
    const sidebarContent = generateSidebar(content);
    await fs.writeFile(path.join(courseDir, '_sidebar.md'), sidebarContent);
    
    // Update lastModified tracking
    try {
      const indexContent = await fs.readFile(indexPath, 'utf-8');
      const courses = JSON.parse(indexContent);
      const courseIndex = courses.findIndex(c => c.proj === id);
      
      if (courseIndex >= 0) {
        courses[courseIndex].lastModifiedBy = req.admin.email;
        courses[courseIndex].lastModifiedAt = new Date().toISOString();
        await fs.writeFile(indexPath, JSON.stringify(courses, null, 2));
      }
    } catch (err) {
      console.error('Failed to update tracking:', err);
    }
    
    console.log(`✅ README uploaded for: ${id} by ${req.admin.email}`);
    
    res.json({ success: true, message: 'README uploaded successfully' });
    
  } catch (error) {
    console.error('Error uploading README:', error);
    res.status(500).json({ error: 'Failed to upload README: ' + error.message });
  }
});

// PUT /api/courses/:id
// Update course content (author, collaborators, super admin)
router.put('/:id', verifyAdmin, checkContentEditAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }

    const docsDir = path.join(__dirname, '../../client/public/docs');
    const courseDir = path.join(docsDir, id);
    const readmePath = path.join(courseDir, 'README.md');
    const indexPath = path.join(docsDir, 'index.json');

    await fs.writeFile(readmePath, content);

    const sidebarContent = generateSidebar(content);
    await fs.writeFile(path.join(courseDir, '_sidebar.md'), sidebarContent);

    // Update lastModified tracking
    try {
      const indexContent = await fs.readFile(indexPath, 'utf-8');
      const courses = JSON.parse(indexContent);
      const courseIndex = courses.findIndex(c => c.proj === id);
      
      if (courseIndex >= 0) {
        courses[courseIndex].lastModifiedBy = req.admin.email;
        courses[courseIndex].lastModifiedAt = new Date().toISOString();
        await fs.writeFile(indexPath, JSON.stringify(courses, null, 2));
      }
    } catch (err) {
      console.error('Failed to update tracking:', err);
    }

    console.log(`✅ Course content updated: ${id} by ${req.admin.email}`);

    res.json({ success: true, message: 'Course content updated successfully' });

  } catch (error) {
    console.error('Error updating course:', error);
    res.status(500).json({ error: 'Failed to update course: ' + error.message });
  }
});

// ============================================
// IMAGE MANAGEMENT ROUTES
// ============================================

// Configure multer for image uploads
const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const courseId = req.params.id;
    // Change this path to docs directory
    const uploadDir = path.join(__dirname, '../../client/public/docs', courseId, 'images');
    
    const fsSync = require('fs');
    fsSync.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const imageUpload = multer({ 
  storage: imageStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit per file
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// POST /api/courses/:id/images
// Upload multiple images to a course
router.post('/:id/images', verifyAdmin, checkContentEditAccess, imageUpload.array('images', 10), async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No images uploaded' });
    }

    const uploadedFiles = req.files.map(file => file.filename);
    
    console.log(`✅ ${uploadedFiles.length} image(s) uploaded for course ${id}`);
    
    res.json({ 
      success: true, 
      message: `${uploadedFiles.length} image(s) uploaded successfully`,
      images: uploadedFiles
    });

  } catch (error) {
    console.error('Error uploading images:', error);
    res.status(500).json({ error: 'Failed to upload images: ' + error.message });
  }
});

// GET /api/courses/:id/images
// List all images for a course
router.get('/:id/images', async (req, res) => {
  try {
    const { id } = req.params;
    const imagesDir = path.join(__dirname, '../../client/public/docs', id, 'images');

    try {
      const files = await fs.readdir(imagesDir);
      const imageFiles = files.filter(file => {
        const ext = path.extname(file).toLowerCase();
        return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'].includes(ext);
      });
      
      res.json({ success: true, images: imageFiles });
    } catch (err) {
      // Directory doesn't exist or is empty
      res.json({ success: true, images: [] });
    }

  } catch (error) {
    console.error('Error listing images:', error);
    res.status(500).json({ error: 'Failed to list images' });
  }
});

// GET /api/courses/:id/images/:name
// Serve/download a specific image
router.get('/:id/images/:name', async (req, res) => {
  try {
    const { id, name } = req.params;
    const imagePath = path.join(__dirname, '../../client/public/docs', id, 'images', name);

    try {
      await fs.access(imagePath);
      res.sendFile(imagePath);
    } catch (err) {
      res.status(404).json({ error: 'Image not found' });
    }

  } catch (error) {
    console.error('Error serving image:', error);
    res.status(500).json({ error: 'Failed to serve image' });
  }
});

// DELETE /api/courses/:id/images/:name
// Delete a specific image
router.delete('/:id/images/:name', verifyAdmin, checkContentEditAccess, async (req, res) => {
  try {
    const { id, name } = req.params;
    const imagePath = path.join(__dirname, '../../client/public/docs', id, 'images', name);

    try {
      await fs.unlink(imagePath);
      console.log(`✅ Image deleted: ${name} from course ${id}`);
      res.json({ success: true, message: 'Image deleted successfully' });
    } catch (err) {
      res.status(404).json({ error: 'Image not found' });
    }

  } catch (error) {
    console.error('Error deleting image:', error);
    res.status(500).json({ error: 'Failed to delete image' });
  }
});

module.exports = router;