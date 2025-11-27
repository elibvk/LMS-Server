const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { verifyAdmin } = require('../middleware/auth');
const multer = require('multer');
const crypto = require('crypto');
const { sendEmail } = require('../utils/email');
const Course = require('../models/Course');
const User = require('../models/User');
const router = express.Router();
const CourseId = require('../models/CourseId');

// Multer configuration - memory storage for flexibility
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Constants
const DOCS_ROOT = path.join(__dirname, '../../client/public/docs');

// ============================================
// HELPER FUNCTIONS
// ============================================

// Helper: pad number to 4 digits
function padId(num) {
  return String(num).padStart(4, '0');
}

// Helper: slug generation (fixed on creation)
function generateSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 50);
}

// Assign next available (lowest) 4-digit ID, reusing deleted ones
async function assignNextAvailableCourseId() {
  const doc = await CourseId.findOne() || new CourseId();
  const usedSet = new Set(doc.used || []);

  let candidate = 1;
  while (true) {
    const pid = padId(candidate);
    if (!usedSet.has(pid)) {
      doc.used.push(pid);
      await doc.save();
      return pid;
    }
    candidate += 1;
    if (candidate > 9999) throw new Error('No available course IDs');
  }
}

// Free (make reusable) a courseId
async function freeCourseId(projectId) {
  const doc = await CourseId.findOne();
  if (!doc) return;
  const idx = (doc.used || []).indexOf(projectId);
  if (idx !== -1) {
    doc.used.splice(idx, 1);
    await doc.save();
  }
}

// Helper functions for HTML escaping
function escapeHtml(str = '') {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeQuotes(str = '') {
  return String(str).replace(/"/g, '\\"').replace(/'/g, "\\'");
}

// Docsify template generator
const DOCSIFY_TEMPLATE = (title) => `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(title)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="//cdn.jsdelivr.net/npm/docsify@4/lib/themes/vue.css">
  <style>
    /* Hide sidebar and expand content for embedding in iframe */
    .sidebar, aside.sidebar, .sidebar-toggle { display: none !important; }
    .content, main { left: 0 !important; margin-left: 0 !important; max-width: 100% !important; padding-left: 2rem !important; }
  </style>
</head>
<body>
  <div id="app">Loading...</div>
  <script>
    window.$docsify = {
      name: "${escapeQuotes(title)}",
      repo: "",
      loadSidebar: false,
      hideSidebar: true,
      subMaxLevel: 2,
      loadNavbar: false,
      copyCode: {
        buttonText: '📋 Copy',
        errorText: '✖ Failed',
        successText: '✓ Copied!'
      }
    };
  </script>
  <script src="//cdn.jsdelivr.net/npm/docsify@4"></script>
  <script src="//cdn.jsdelivr.net/npm/docsify-copy-code"></script>
</body>
</html>`;

/**
 * Create course files on disk: README.md, _sidebar.md, index.html, images dir
 * @param {String} projectId  // "0001"
 * @param {String} title
 * @param {String} readmeContent - optional initial content
 */
async function createCourseFilesOnDisk(projectId, title, readmeContent = null) {
  const courseDir = path.join(DOCS_ROOT, projectId);
  try {
    await fs.mkdir(courseDir, { recursive: true });
    await fs.mkdir(path.join(courseDir, 'images'), { recursive: true });

    const readme = readmeContent || `# ${title}\n\nStart writing your course content here...\n`;
    await fs.writeFile(path.join(courseDir, 'README.md'), readme, 'utf8');

    const sidebar = `* [Home](README.md)\n`;
    await fs.writeFile(path.join(courseDir, '_sidebar.md'), sidebar, 'utf8');

    const indexHtml = DOCSIFY_TEMPLATE(title);
    await fs.writeFile(path.join(courseDir, 'index.html'), indexHtml, 'utf8');

    console.log(`✅ Files created on disk for ${projectId}`);
    return true;
  } catch (err) {
    console.error('Error creating course files on disk:', err);
    throw err;
  }
}

/**
 * Read README.md content from disk
 * @param {String} projectId
 * @returns {String} content
 */
async function readCourseContent(projectId) {
  const readmePath = path.join(DOCS_ROOT, projectId, 'README.md');
  try {
    const content = await fs.readFile(readmePath, 'utf8');
    return content;
  } catch (err) {
    console.error(`Error reading README for ${projectId}:`, err);
    return '';
  }
}

/**
 * Update README.md content on disk and regenerate sidebar
 * @param {String} projectId
 * @param {String} content
 */
async function updateCourseContent(projectId, content) {
  const readmePath = path.join(DOCS_ROOT, projectId, 'README.md');
  const sidebarPath = path.join(DOCS_ROOT, projectId, '_sidebar.md');
  
  try {
    // Write README.md
    await fs.writeFile(readmePath, content, 'utf8');

    // Regenerate sidebar from headers
    const lines = content.split('\n');
    const headers = [];
    for (const line of lines) {
      const match = line.match(/^##\s+(.+)$/);
      if (match) {
        const title = match[1].trim();
        const anchor = title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');
        headers.push(`* [${title}](README.md#${anchor})`);
      }
    }
    const sidebar = headers.length > 0 ? headers.join('\n') : '* [Home](README.md)';
    await fs.writeFile(sidebarPath, sidebar, 'utf8');

    console.log(`✅ Course content updated on disk: ${projectId}`);
    return true;
  } catch (err) {
    console.error(`Error updating course content for ${projectId}:`, err);
    throw err;
  }
}

// Helper: Update index.json for backward compatibility
async function updateIndexJson() {
  try {
    const indexPath = path.join(DOCS_ROOT, 'index.json');
    
    const courses = await Course.find({}).sort({ projectId: 1 });
    
    const indexData = courses.map(course => ({
      proj: course.projectId,
      slug: course.slug || '',
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
    console.log('✅ index.json updated');
    return true;
  } catch (error) {
    console.error('Error updating index.json:', error);
    return false;
  }
}

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
  
  try {
    await fs.access(dataDir);
  } catch {
    await fs.mkdir(dataDir, { recursive: true });
  }
  
  await fs.writeFile(invitesPath, JSON.stringify(invites, null, 2));
}

// Helper: Load pending user invitations
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

// ============================================
// COURSE CRUD ROUTES
// ============================================

// POST /api/courses/create
router.post('/create', verifyAdmin, async (req, res) => {
  try {
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

      // Assign numeric ID and slug
      const projectId = await assignNextAvailableCourseId(); // e.g. "0001"
      const slug = generateSlug(title);

      // Check if course already exists
      const existing = await Course.findOne({ projectId });
      if (existing) {
        return res.status(400).json({ error: 'Course with this ID already exists' });
      }

      // Handle README content
      let readmeContent = null;
      if (req.files && req.files['readme'] && req.files['readme'][0]) {
        readmeContent = req.files['readme'][0].buffer.toString('utf-8');
      }

      // Build metadata for MongoDB (NO CONTENT!)
      const newCourse = new Course({
        projectId,
        slug,
        title,
        description: description || '',
        keywords: keywords ? (Array.isArray(keywords) ? keywords : keywords.split(',').map(k => k.trim())) : [],
        createdBy: req.admin.email,
        lastModifiedBy: req.admin.email,
        collaborators: []
      });

      // Save metadata to MongoDB
      await newCourse.save();

      // Create files on disk (README, _sidebar.md, index.html, images folder)
      await createCourseFilesOnDisk(projectId, title, readmeContent);

      // Handle uploaded images (if any)
      if (req.files && req.files['images'] && req.files['images'].length > 0) {
        const imagesDir = path.join(DOCS_ROOT, projectId, 'images');
        await fs.mkdir(imagesDir, { recursive: true });
        for (const imageFile of req.files['images']) {
          const imagePath = path.join(imagesDir, `${Date.now()}-${imageFile.originalname}`);
          await fs.writeFile(imagePath, imageFile.buffer);
        }
        console.log(`✅ ${req.files['images'].length} image(s) uploaded for new course ${projectId}`);
      }

      // Update index.json for backward compatibility
      await updateIndexJson();

      console.log(`✅ Course created: ${projectId} by ${req.admin.email}`);

      res.json({
        success: true,
        message: 'Course created successfully',
        course: { 
          id: projectId, 
          title, 
          description, 
          keywords: newCourse.keywords 
        }
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
    const courses = await Course.find({})
      .select('projectId slug title description keywords createdBy createdAt lastModifiedBy lastModifiedAt collaborators')
      .sort({ projectId: 1 });

    res.json({ 
      courses: courses.map(c => ({
        proj: c.projectId,
        slug: c.slug,
        title: c.title,
        description: c.description,
        keywords: c.keywords,
        createdBy: c.createdBy,
        createdAt: c.createdAt,
        lastModifiedBy: c.lastModifiedBy,
        lastModifiedAt: c.lastModifiedAt,
        collaborators: c.collaborators
      }))
    });
  } catch (error) {
    console.error('Error fetching courses:', error);
    res.status(500).json({ error: 'Failed to fetch courses' });
  }
});

// GET /api/courses/:id  => returns metadata + README content FROM DISK
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const course = await Course.findOne({ projectId: id });

    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    // Read content from disk
    const content = await readCourseContent(id);

    // Normalize metadata
    const courseMeta = {
      proj: course.projectId,
      slug: course.slug,
      title: course.title || '',
      description: course.description || '',
      keywords: Array.isArray(course.keywords) ? course.keywords : [],
      createdBy: course.createdBy || '',
      createdAt: course.createdAt || null,
      lastModifiedBy: course.lastModifiedBy || '',
      lastModifiedAt: course.lastModifiedAt || null,
      collaborators: course.collaborators || []
    };

    res.json({
      success: true,
      course: courseMeta,
      content: content // From disk, not MongoDB!
    });
  } catch (error) {
    console.error('Error reading course:', error);
    res.status(500).json({ error: 'Failed to read course content' });
  }
});

// GET /api/courses/:id/permissions
router.get('/:id/permissions', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const userEmail = req.admin.email;
    const userRole = req.admin.role;
    
    const course = await Course.findOne({ projectId: id });
    
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    const isSuperAdmin = userRole === 'super_admin';
    const isAuthor = course.createdBy === userEmail;
    const isCollaborator = course.collaborators.some(
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

// DELETE /api/courses/:id
router.delete('/:id', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const userEmail = req.admin.email;
    const userRole = req.admin.role;

    const course = await Course.findOne({ projectId: id });

    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const isSuperAdmin = userRole === 'super_admin';
    const isAuthor = course.createdBy === userEmail;

    if (!isSuperAdmin && !isAuthor) {
      return res.status(403).json({
        error: 'You do not have permission to delete this course',
        message: 'Only the course author or super admins can delete courses'
      });
    }

    // Delete from MongoDB
    await Course.deleteOne({ projectId: id });

    // Delete files from disk
    const courseDir = path.join(DOCS_ROOT, id);
    await fs.rm(courseDir, { recursive: true, force: true });

    // Update index.json
    await updateIndexJson();

    // Free up the courseId for reuse
    await freeCourseId(id);

    console.log(`🗑️ Course deleted: ${id} by ${userEmail}`);

    res.json({ success: true, message: 'Course deleted successfully' });

  } catch (error) {
    console.error('Error deleting course:', error);
    res.status(500).json({ error: 'Failed to delete course: ' + error.message });
  }
});

// GET /api/courses/:id/info
router.get('/:id/info', async (req, res) => {
  try {
    const { id } = req.params;
    const course = await Course.findOne({ projectId: id });
    
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    res.json({
      course: {
        title: course.title,
        description: course.description,
        keywords: course.keywords,
        createdBy: course.createdBy,
        createdAt: course.createdAt,
        lastModifiedBy: course.lastModifiedBy,
        lastModifiedAt: course.lastModifiedAt,
        collaborators: course.collaborators
      }
    });
    
  } catch (error) {
    console.error('Error getting course info:', error);
    res.status(500).json({ error: 'Failed to get course info' });
  }
});

// PUT /api/courses/:id/info
router.put('/:id/info', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, keywords } = req.body;
    
    const course = await Course.findOne({ projectId: id });
    
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    // Check permissions
    if (!course.canEditInfo(req.admin.email, req.admin.role)) {
      return res.status(403).json({ 
        error: 'You do not have permission to edit course information',
        message: 'Only the course author or super admins can edit course info'
      });
    }
    
    // Update course info in MongoDB
    if (title) course.title = title;
    if (description !== undefined) course.description = description;
    if (keywords !== undefined) {
      course.keywords = Array.isArray(keywords) 
        ? keywords 
        : (keywords ? keywords.split(',').map(k => k.trim()) : []);
    }
    
    course.lastModifiedBy = req.admin.email;
    course.lastModifiedAt = new Date();
    
    await course.save();
    
    // Update index.json
    await updateIndexJson();
    
    // If title changed, regenerate index.html on disk
    if (title) {
      const indexHtml = DOCSIFY_TEMPLATE(title);
      await fs.writeFile(path.join(DOCS_ROOT, id, 'index.html'), indexHtml, 'utf8');
    }
    
    console.log(`✅ Course info updated: ${id} by ${req.admin.email}`);
    
    res.json({ success: true, message: 'Course info updated' });
    
  } catch (error) {
    console.error('Error updating course info:', error);
    res.status(500).json({ error: 'Failed to update course info' });
  }
});

// PUT /api/courses/:id  => update README content on disk
router.put('/:id', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }

    const course = await Course.findOne({ projectId: id });
    
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    // Check permissions
    if (!course.canEditContent(req.admin.email, req.admin.role)) {
      return res.status(403).json({ 
        error: 'You do not have permission to edit this course content',
        message: 'Only the course author, collaborators, or super admins can edit content'
      });
    }

    // Update content on disk (this also regenerates sidebar)
    await updateCourseContent(id, content);

    // Update metadata in MongoDB
    course.lastModifiedBy = req.admin.email;
    course.lastModifiedAt = new Date();
    await course.save();

    // Update index.json
    await updateIndexJson();

    console.log(`✅ Course content updated: ${id} by ${req.admin.email}`);

    res.json({ success: true, message: 'Course content updated successfully' });

  } catch (error) {
    console.error('Error updating course:', error);
    res.status(500).json({ error: 'Failed to update course: ' + error.message });
  }
});

// POST /api/courses/:id/upload-readme
router.post('/:id/upload-readme', verifyAdmin, upload.single('readme'), async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const course = await Course.findOne({ projectId: id });
    
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    // Check permissions
    if (!course.canEditContent(req.admin.email, req.admin.role)) {
      return res.status(403).json({ 
        error: 'You do not have permission to edit this course content'
      });
    }

    const content = req.file.buffer.toString('utf-8');
    
    // Update content on disk (this also regenerates sidebar)
    await updateCourseContent(id, content);

    // Update metadata in MongoDB
    course.lastModifiedBy = req.admin.email;
    course.lastModifiedAt = new Date();
    await course.save();

    // Update index.json
    await updateIndexJson();

    console.log(`✅ README uploaded for course ${id} by ${req.admin.email}`);

    res.json({ success: true, message: 'README uploaded successfully' });

  } catch (error) {
    console.error('Error uploading README:', error);
    res.status(500).json({ error: 'Failed to upload README: ' + error.message });
  }
});

// GET /api/courses/:id/download
router.get('/:id/download', async (req, res) => {
  try {
    const { id } = req.params;
    const course = await Course.findOne({ projectId: id });

    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    // Read content from disk
    const content = await readCourseContent(id);

    // Create temporary file
    const tempPath = path.join(__dirname, '../temp', `${id}_README.md`);
    const tempDir = path.join(__dirname, '../temp');
    
    await fs.mkdir(tempDir, { recursive: true });
    await fs.writeFile(tempPath, content);

    res.download(tempPath, `${id}_README.md`, async (err) => {
      // Clean up temp file
      try {
        await fs.unlink(tempPath);
      } catch (e) {}
      
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

// ============================================
// COLLABORATOR MANAGEMENT ROUTES
// ============================================

// POST /api/courses/:id/collaborators
router.post('/:id/collaborators', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { email } = req.body;
    
    if (!email || !email.trim()) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    const collaboratorEmail = email.trim().toLowerCase();
    
    if (collaboratorEmail === req.admin.email) {
      return res.status(400).json({ error: 'You cannot add yourself as a collaborator' });
    }
    
    const course = await Course.findOne({ projectId: id });
    
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    // Check permissions
    if (!course.canEditInfo(req.admin.email, req.admin.role)) {
      return res.status(403).json({ 
        error: 'You do not have permission to manage collaborators'
      });
    }
    
    // Check if already a collaborator
    const existingCollab = course.collaborators.find(c => c.email === collaboratorEmail);
    if (existingCollab) {
      return res.status(400).json({ 
        error: `${collaboratorEmail} is already a collaborator (status: ${existingCollab.status})` 
      });
    }
    
    // Check if user exists
    const existingUser = await User.findOne({ email: collaboratorEmail });
    
    if (existingUser) {
      // User exists - add as collaborator with pending status
      const token = crypto.randomBytes(32).toString('hex');
      const now = new Date();
      
      course.collaborators.push({
        email: collaboratorEmail,
        status: 'pending',
        addedBy: req.admin.email,
        addedAt: now,
        inviteToken: token
      });
      
      await course.save();
      await updateIndexJson();
      
      // Create invitation record
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
        createdAt: now.toISOString(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      });
      await saveInvites(invites);
      
      // Send email
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
      // User doesn't exist - create pending invitation
      const inviteToken = crypto.randomBytes(32).toString('hex');
      const now = new Date();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      
      const pendingInvites = await loadPendingUserInvitations();
      const existingInvite = pendingInvites.find(
        inv => inv.email === collaboratorEmail && inv.courseId === id && inv.status === 'pending'
      );
      
      if (existingInvite) {
        return res.status(400).json({ error: 'Invitation already sent to this email' });
      }
      
      pendingInvites.push({
        id: `user_invite_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        email: collaboratorEmail,
        courseId: id,
        courseTitle: course.title,
        invitedBy: req.admin.email,
        inviterName: req.admin.name,
        token: inviteToken,
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        status: 'pending'
      });
      await savePendingUserInvitations(pendingInvites);
      
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

// DELETE /api/courses/:id/collaborators/:email
router.delete('/:id/collaborators/:email', verifyAdmin, async (req, res) => {
  try {
    const { id, email } = req.params;
    
    const course = await Course.findOne({ projectId: id });
    
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    // Check permissions
    if (!course.canEditInfo(req.admin.email, req.admin.role)) {
      return res.status(403).json({ 
        error: 'You do not have permission to manage collaborators'
      });
    }
    
    const originalLength = course.collaborators.length;
    course.collaborators = course.collaborators.filter(c => c.email !== email);
    
    if (course.collaborators.length === originalLength) {
      return res.status(404).json({ error: 'Collaborator not found' });
    }
    
    await course.save();
    await updateIndexJson();
    
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

// GET /api/courses/:id/pending-user-invitations
router.get('/:id/pending-user-invitations', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    const course = await Course.findOne({ projectId: id });
    
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    // Check permissions
    if (!course.canEditInfo(req.admin.email, req.admin.role)) {
      return res.status(403).json({ 
        error: 'You do not have permission to view invitations'
      });
    }
    
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
router.delete('/:id/pending-user-invitations/:email', verifyAdmin, async (req, res) => {
  try {
    const { id, email } = req.params;
    
    const course = await Course.findOne({ projectId: id });
    
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    // Check permissions
    if (!course.canEditInfo(req.admin.email, req.admin.role)) {
      return res.status(403).json({ 
        error: 'You do not have permission to manage invitations'
      });
    }
    
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
router.post('/invitations/accept', verifyAdmin, async (req, res) => {
  try {
    const { token } = req.body;
    const userEmail = req.admin.email;

    const invitations = await loadPendingUserInvitations();
    const inviteIndex = invitations.findIndex(
      inv => inv.token === token && inv.email === userEmail && inv.status === 'pending' && new Date(inv.expiresAt) > new Date()
    );

    if (inviteIndex === -1) {
      return res.status(404).json({ error: 'Invalid or expired invitation' });
    }

    const invitation = invitations[inviteIndex];

    // Add user as collaborator to the course
    const course = await Course.findOne({ projectId: invitation.courseId });
    
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    const existingCollab = course.collaborators.find(c => c.email === userEmail);
    if (!existingCollab) {
      course.collaborators.push({
        email: userEmail,
        addedBy: invitation.invitedBy,
        addedAt: new Date(),
        status: 'accepted'
      });
      
      await course.save();
      await updateIndexJson();
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

// ============================================
// IMAGE MANAGEMENT ROUTES
// ============================================

// Configure multer for image uploads
const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const courseId = req.params.id;
    const uploadDir = path.join(DOCS_ROOT, courseId, 'images');
    
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
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// POST /api/courses/:id/images
router.post('/:id/images', verifyAdmin, imageUpload.array('images', 10), async (req, res) => {
  try {
    const { id } = req.params;
    
    const course = await Course.findOne({ projectId: id });
    
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    // Check permissions
    if (!course.canEditContent(req.admin.email, req.admin.role)) {
      return res.status(403).json({ 
        error: 'You do not have permission to upload images'
      });
    }
    
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
router.get('/:id/images', async (req, res) => {
  try {
    const { id } = req.params;
    const imagesDir = path.join(DOCS_ROOT, id, 'images');

    try {
      const files = await fs.readdir(imagesDir);
      const imageFiles = files.filter(file => {
        const ext = path.extname(file).toLowerCase();
        return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'].includes(ext);
      });
      
      res.json({ success: true, images: imageFiles });
    } catch (err) {
      res.json({ success: true, images: [] });
    }

  } catch (error) {
    console.error('Error listing images:', error);
    res.status(500).json({ error: 'Failed to list images' });
  }
});

// GET /api/courses/:id/images/:name
router.get('/:id/images/:name', async (req, res) => {
  try {
    const { id, name } = req.params;
    const imagePath = path.join(DOCS_ROOT, id, 'images', name);

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
router.delete('/:id/images/:name', verifyAdmin, async (req, res) => {
  try {
    const { id, name } = req.params;
    
    const course = await Course.findOne({ projectId: id });
    
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    // Check permissions
    if (!course.canEditContent(req.admin.email, req.admin.role)) {
      return res.status(403).json({ 
        error: 'You do not have permission to delete images'
      });
    }
    
    const imagePath = path.join(DOCS_ROOT, id, 'images', name);

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

// const express = require('express');
// const path = require('path');
// const fs = require('fs').promises;
// const { verifyAdmin } = require('../middleware/auth');
// const multer = require('multer');
// const crypto = require('crypto');
// const { sendEmail } = require('../utils/email');
// const Course = require('../models/Course');
// const User = require('../models/User');
// const router = express.Router();
// const CourseId = require('../models/CourseId');
// const storage = multer.memoryStorage();
// const upload = multer({ storage });

// // Helper: Generate course ID from title
// // function generateCourseId(title) {
// //   return title
// //     .toLowerCase()
// //     .replace(/[^a-z0-9\s-]/g, '')
// //     .trim()
// //     .replace(/\s+/g, '-')
// //     .slice(0, 50);
// // }

// // Helper: pad number to 4 digits
// function padId(num) {
//   return String(num).padStart(4, '0');
// }

// // Helper: slug generation (fixed on creation)
// function generateSlug(title) {
//   return title
//     .toLowerCase()
//     .replace(/[^a-z0-9\s-]/g, '')
//     .trim()
//     .replace(/\s+/g, '-')
//     .slice(0, 50);
// }

// // Assign next available (lowest) 4-digit ID, reusing deleted ones
// async function assignNextAvailableCourseId() {
//   // load or create the single CourseId doc
//   const doc = await CourseId.findOne() || new CourseId();
//   const usedSet = new Set(doc.used || []);

//   // search from 1 upwards for smallest missing
//   let candidate = 1;
//   while (true) {
//     const pid = padId(candidate);
//     if (!usedSet.has(pid)) {
//       // add to used and save
//       doc.used.push(pid);
//       await doc.save();
//       return pid;
//     }
//     candidate += 1;
//     // safety cap (shouldn't be hit)
//     if (candidate > 9999) throw new Error('No available course IDs');
//   }
// }

// // Free (make reusable) a courseId
// async function freeCourseId(projectId) {
//   const doc = await CourseId.findOne();
//   if (!doc) return;
//   const idx = (doc.used || []).indexOf(projectId);
//   if (idx !== -1) {
//     doc.used.splice(idx, 1);
//     await doc.save();
//   }
// }

// // Helper: Write files to disk from MongoDB data
// async function syncFilesToDisk(course) {
//   try {
//     const docsDir = path.join(__dirname, '../../client/public/docs');
//     const courseDir = path.join(docsDir, course.projectId);
    
//     // Create course directory and images subfolder
//     await fs.mkdir(courseDir, { recursive: true });
//     await fs.mkdir(path.join(courseDir, 'images'), { recursive: true });
    
//     // Write README.md
//     await fs.writeFile(
//       path.join(courseDir, 'README.md'),
//       course.readmeContent || `# ${course.title}\n\nStart writing your course content here...`
//     );
    
//     // Write _sidebar.md
//     await fs.writeFile(
//       path.join(courseDir, '_sidebar.md'),
//       course.sidebarContent || '* [Home](README.md)'
//     );

//     // Prepare a safe docsify index.html template that hides sidebar and expands content
//     // If course.indexHtmlContent exists (custom), prefer that; otherwise generate default.
//     const docsifyTemplate = `
// <!DOCTYPE html>
// <html>
// <head>
//   <meta charset="UTF-8">
//   <title>${(course.title || '').replace(/"/g, '&quot;')}</title>
//   <meta name="viewport" content="width=device-width, initial-scale=1">
//   <link rel="stylesheet" href="//cdn.jsdelivr.net/npm/docsify@4/lib/themes/vue.css">
//   <style>
//     /* Force hide Docsify sidebar and expand content for embedding in cross-origin iframe */
//     .sidebar,
//     aside.sidebar,
//     .sidebar-toggle {
//       display: none !important;
//     }
//     .content,
//     main {
//       left: 0 !important;
//       margin-left: 0 !important;
//       max-width: 100% !important;
//       padding-left: 2rem !important;
//     }
//   </style>
// </head>
// <body>
//   <div id="app">Loading...</div>

//   <script>
//     window.$docsify = {
//       name: "${(course.title || '').replace(/"/g, '&quot;')}",
//       repo: "",
//       loadSidebar: false,
//       hideSidebar: true,
//       subMaxLevel: 2,
//       loadNavbar: false,
//       copyCode: {
//         buttonText: '📋 Copy',
//         errorText: '✖ Failed',
//         successText: '✓ Copied!'
//       }
//     };
//   </script>

//   <script src="//cdn.jsdelivr.net/npm/docsify@4"></script>
//   <script src="//cdn.jsdelivr.net/npm/docsify-copy-code"></script>
// </body>
// </html>
// `;

//     const indexHtmlContent = course.indexHtmlContent || docsifyTemplate;

//     // Write index.html
//     await fs.writeFile(
//       path.join(courseDir, 'index.html'),
//       indexHtmlContent
//     );
    
//     // Update sync status in MongoDB
//     course.filesSynced = true;
//     course.lastSyncedAt = new Date();
//     await course.save();
    
//     console.log(`✅ Files synced to disk for course: ${course.projectId}`);
//     return true;
//   } catch (error) {
//     console.error('Error syncing files to disk:', error);
//     return false;
//   }
// }
// const DOCS_ROOT = path.join(__dirname, '../../client/public/docs');
// const DOCSIFY_TEMPLATE = (title) => `<!DOCTYPE html>
// <html>
// <head>
//   <meta charset="UTF-8">
//   <title>${escapeHtml(title)}</title>
//   <meta name="viewport" content="width=device-width, initial-scale=1">
//   <link rel="stylesheet" href="//cdn.jsdelivr.net/npm/docsify@4/lib/themes/vue.css">
//   <style>
//     /* Hide sidebar and expand content for embedding in iframe */
//     .sidebar, aside.sidebar, .sidebar-toggle { display: none !important; }
//     .content, main { left: 0 !important; margin-left: 0 !important; max-width: 100% !important; padding-left: 2rem !important; }
//   </style>
// </head>
// <body>
//   <div id="app">Loading...</div>
//   <script>
//     window.$docsify = {
//       name: "${escapeQuotes(title)}",
//       repo: "",
//       loadSidebar: false,
//       hideSidebar: true,
//       subMaxLevel: 2,
//       loadNavbar: false
//     };
//   </script>
//   <script src="//cdn.jsdelivr.net/npm/docsify@4"></script>
// </body>
// </html>`;

// // small helper to escape HTML and quotes:
// function escapeHtml(str = '') {
//   return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// }
// function escapeQuotes(str = '') {
//   return String(str).replace(/"/g, '\\"').replace(/'/g, "\\'");
// }

// /**
//  * Create course files on disk: README.md, _sidebar.md, index.html, images dir
//  * @param {String} projectId  // "0001"
//  * @param {String} title
//  */
// async function createCourseFilesOnDisk(projectId, title) {
//   const courseDir = path.join(DOCS_ROOT, projectId);
//   try {
//     await fs.mkdir(courseDir, { recursive: true });
//     await fs.mkdir(path.join(courseDir, 'images'), { recursive: true });

//     const readme = `# ${title}\n\nStart writing your course content here...\n`;
//     await fs.writeFile(path.join(courseDir, 'README.md'), readme, 'utf8');

//     const sidebar = `* [Home](README.md)\n`;
//     await fs.writeFile(path.join(courseDir, '_sidebar.md'), sidebar, 'utf8');

//     const indexHtml = DOCSIFY_TEMPLATE(title);
//     await fs.writeFile(path.join(courseDir, 'index.html'), indexHtml, 'utf8');

//     console.log(`✅ Files created on disk for ${projectId}`);
//     return true;
//   } catch (err) {
//     console.error('Error creating course files on disk:', err);
//     throw err;
//   }
// }
// uploadMultiple(req, res, async (err) => {
//   if (err) return res.status(400).json({ error: 'File upload error: ' + err.message });

//   const { title, description, keywords } = req.body;
//   if (!title) return res.status(400).json({ error: 'Title is required' });

//   // assign numeric ID and slug
//   const projectId = await assignNextAvailableCourseId(); // "0001"
//   const slug = generateSlug(title);

//   // avoid collision (shouldn't normally happen)
//   const existing = await Course.findOne({ projectId });
//   if (existing) {
//     return res.status(400).json({ error: 'Course with this ID already exists' });
//   }

//   // Build metadata
//   const newCourse = new Course({
//     projectId,
//     slug,
//     title,
//     description: description || '',
//     keywords: keywords ? (Array.isArray(keywords) ? keywords : keywords.split(',').map(k => k.trim())) : [],
//     createdBy: req.admin.email,
//     lastModifiedBy: req.admin.email,
//     collaborators: []
//   });

//   // Save metadata
//   await newCourse.save();

//   // Create files on disk (README, _sidebar.md, index.html, images folder)
//   await createCourseFilesOnDisk(projectId, title);

//   // Handle uploaded readme (if provided) - write uploaded content to README.md
//   if (req.files && req.files['readme'] && req.files['readme'][0]) {
//     const readmeText = req.files['readme'][0].buffer.toString('utf8');
//     await fs.writeFile(path.join(DOCS_ROOT, projectId, 'README.md'), readmeText, 'utf8');
//   }

//   // Handle uploaded images (if any) - multer's memory storage for main endpoint
//   if (req.files && req.files['images'] && req.files['images'].length > 0) {
//     const imagesDir = path.join(DOCS_ROOT, projectId, 'images');
//     await fs.mkdir(imagesDir, { recursive: true });
//     for (const imageFile of req.files['images']) {
//       const imagePath = path.join(imagesDir, `${Date.now()}-${imageFile.originalname}`);
//       await fs.writeFile(imagePath, imageFile.buffer);
//     }
//     console.log(`✅ ${req.files['images'].length} image(s) uploaded for new course ${projectId}`);
//   }

//   // Update index.json for backward compatibility
//   await updateIndexJson();

//   // Mark filesSynced
//   newCourse.filesSynced = true;
//   newCourse.lastSyncedAt = new Date();
//   await newCourse.save();

//   console.log(`✅ Course created: ${projectId} by ${req.admin.email}`);

//   return res.json({
//     success: true,
//     message: 'Course created successfully',
//     course: { id: projectId, title, description, keywords: newCourse.keywords }
//   });
// });



// // Helper: Update index.json for backward compatibility
// async function updateIndexJson() {
//   try {
//     const docsDir = path.join(__dirname, '../../client/public/docs');
//     const indexPath = path.join(docsDir, 'index.json');
    
//     // Get all courses from MongoDB
//     const courses = await Course.find({}).sort({ projectId: 1 });
    
//     // Convert to old format
//     const indexData = courses.map(course => ({
//       proj: course.projectId,
//       slug: course.slug || '',
//       title: course.title,
//       description: course.description,
//       keywords: course.keywords,
//       createdBy: course.createdBy,
//       createdAt: course.createdAt,
//       lastModifiedBy: course.lastModifiedBy,
//       lastModifiedAt: course.lastModifiedAt,
//       collaborators: course.collaborators
//     }));
    
//     await fs.writeFile(indexPath, JSON.stringify(indexData, null, 2));
//     console.log('✅ index.json updated');
//     return true;
//   } catch (error) {
//     console.error('Error updating index.json:', error);
//     return false;
//   }
// }

// // Helper: Load collaboration invites
// async function loadInvites() {
//   const invitesPath = path.join(__dirname, '../data/collaboration_invites.json');
//   try {
//     const content = await fs.readFile(invitesPath, 'utf-8');
//     return JSON.parse(content);
//   } catch (err) {
//     return [];
//   }
// }

// // Helper: Save collaboration invites
// async function saveInvites(invites) {
//   const invitesPath = path.join(__dirname, '../data/collaboration_invites.json');
//   const dataDir = path.join(__dirname, '../data');
  
//   try {
//     await fs.access(dataDir);
//   } catch {
//     await fs.mkdir(dataDir, { recursive: true });
//   }
  
//   await fs.writeFile(invitesPath, JSON.stringify(invites, null, 2));
// }

// // Helper: Load pending user invitations
// async function loadPendingUserInvitations() {
//   const invitesPath = path.join(__dirname, '../data/pending_user_invitations.json');
//   try {
//     const content = await fs.readFile(invitesPath, 'utf-8');
//     return JSON.parse(content);
//   } catch (err) {
//     return [];
//   }
// }

// // Helper: Save pending user invitations
// async function savePendingUserInvitations(invitations) {
//   const invitesPath = path.join(__dirname, '../data/pending_user_invitations.json');
//   const dataDir = path.join(__dirname, '../data');
  
//   try {
//     await fs.access(dataDir);
//   } catch {
//     await fs.mkdir(dataDir, { recursive: true });
//   }
  
//   await fs.writeFile(invitesPath, JSON.stringify(invitations, null, 2));
// }

// // ============================================
// // COURSE CRUD ROUTES
// // ============================================

// // POST /api/courses/create
// router.post('/create', verifyAdmin, async (req, res) => {
//   try {
//     const uploadMultiple = upload.fields([
//       { name: 'readme', maxCount: 1 },
//       { name: 'images', maxCount: 10 }
//     ]);

//     uploadMultiple(req, res, async (err) => {
//       if (err) {
//         return res.status(400).json({ error: 'File upload error: ' + err.message });
//       }

//       const { title, description, keywords } = req.body;

//       if (!title) {
//         return res.status(400).json({ error: 'Title is required' });
//       }

//       //const courseId = generateCourseId(title);
//       const courseId = await assignNextAvailableCourseId();   // e.g. "0001"
//       const slug = generateSlug(title);

//       // Check if course already exists in MongoDB
//       const existing = await Course.findOne({ projectId: courseId });
//       if (existing) {
//         return res.status(400).json({ error: 'Course with this title already exists' });
//       }

//       // Handle README content
//       let readmeContent = `# ${title}\n\nStart writing your course content here...\n`;
//       if (req.files && req.files['readme'] && req.files['readme'][0]) {
//         readmeContent = req.files['readme'][0].buffer.toString('utf-8');
//       }

//       // Create new course in MongoDB
//       const newCourse = new Course({
//         projectId: courseId,
//         slug,
//         title,
//         description: description || '',
//         keywords: keywords ? (Array.isArray(keywords) ? keywords : keywords.split(',').map(k => k.trim())) : [],
//         readmeContent,
//         createdBy: req.admin.email,
//         lastModifiedBy: req.admin.email,
//         collaborators: []
//       });

//       // Generate sidebar and index.html
//       newCourse.generateSidebar();
//       newCourse.generateIndexHtml();

//       // Save to MongoDB
//       await newCourse.save();

//       // Sync files to disk
//       await syncFilesToDisk(newCourse);

//       // Handle image uploads
//       if (req.files && req.files['images'] && req.files['images'].length > 0) {
//         const imagesDir = path.join(__dirname, '../../client/public/docs', courseId, 'images');
//         await fs.mkdir(imagesDir, { recursive: true });

//         for (const imageFile of req.files['images']) {
//           const imagePath = path.join(imagesDir, `${Date.now()}-${imageFile.originalname}`);
//           await fs.writeFile(imagePath, imageFile.buffer);
//         }

//         console.log(`✅ ${req.files['images'].length} image(s) uploaded for new course ${courseId}`);
//       }

//       // Update index.json for backward compatibility
//       await updateIndexJson();

//       console.log(`✅ Course created: ${courseId} by ${req.admin.email}`);

//       res.json({
//         success: true,
//         message: 'Course created successfully',
//         course: { 
//           id: courseId, 
//           title, 
//           description, 
//           keywords 
//         }
//       });
//     });

//   } catch (error) {
//     console.error('Error creating course:', error);
//     res.status(500).json({ error: 'Failed to create course: ' + error.message });
//   }
// });

// // GET /api/courses
// router.get('/', async (req, res) => {
//   try {
//     const courses = await Course.find({})
//       .select('projectId title description keywords createdBy createdAt lastModifiedBy lastModifiedAt collaborators')
//       .sort({ projectId: 1 });

//     res.json({ 
//       courses: courses.map(c => ({
//         proj: c.projectId,
//         title: c.title,
//         description: c.description,
//         keywords: c.keywords,
//         createdBy: c.createdBy,
//         createdAt: c.createdAt,
//         lastModifiedBy: c.lastModifiedBy,
//         lastModifiedAt: c.lastModifiedAt,
//         collaborators: c.collaborators
//       }))
//     });
//   } catch (error) {
//     console.error('Error fetching courses:', error);
//     res.status(500).json({ error: 'Failed to fetch courses' });
//   }
// });

// // GET /api/courses/:id  
// router.get('/:id', async (req, res) => {
//   try {
//     const { id } = req.params;
//     const course = await Course.findOne({ projectId: id });
//     if (!course) return res.status(404).json({ error: 'Course not found' });

//     const courseMeta = {
//       proj: course.projectId,
//       slug: course.slug || '',
//       title: course.title || '',
//       description: course.description || '',
//       keywords: Array.isArray(course.keywords) ? course.keywords : [],
//       createdBy: course.createdBy || '',
//       createdAt: course.createdAt || null,
//       lastModifiedBy: course.lastModifiedBy || '',
//       lastModifiedAt: course.lastModifiedAt || null,
//       collaborators: course.collaborators || []
//     };

//     const readmeUrl = `${process.env.API_URL ? process.env.API_URL.replace(/\/$/, '') : 'https://api.vijayonline.in'}/docs/${id}/README.md`;

//     res.json({ success: true, course: courseMeta, readmeUrl });
//   } catch (error) {
//     console.error('Error reading course:', error);
//     res.status(500).json({ error: 'Failed to read course content' });
//   }
// });



// // GET /api/courses/:id/permissions
// router.get('/:id/permissions', verifyAdmin, async (req, res) => {
//   try {
//     const { id } = req.params;
//     const userEmail = req.admin.email;
//     const userRole = req.admin.role;
    
//     const course = await Course.findOne({ projectId: id });
    
//     if (!course) {
//       return res.status(404).json({ error: 'Course not found' });
//     }
    
//     const isSuperAdmin = userRole === 'super_admin';
//     const isAuthor = course.createdBy === userEmail;
//     const isCollaborator = course.collaborators.some(
//       c => c.email === userEmail && c.status === 'accepted'
//     );
    
//     res.json({
//       canView: true,
//       canEditContent: isSuperAdmin || isAuthor || isCollaborator,
//       canEditInfo: isSuperAdmin || isAuthor,
//       canManageCollaborators: isSuperAdmin || isAuthor,
//       canDelete: isSuperAdmin || isAuthor,
//       isAuthor,
//       isCollaborator,
//       isSuperAdmin
//     });
    
//   } catch (error) {
//     console.error('Error checking permissions:', error);
//     res.status(500).json({ error: 'Failed to check permissions' });
//   }
// });

// // DELETE /api/courses/:id
// router.delete('/:id', verifyAdmin, async (req, res) => {
//   try {
//     const { id } = req.params;
//     const userEmail = req.admin.email;
//     const userRole = req.admin.role;

//     const course = await Course.findOne({ projectId: id });

//     if (!course) {
//       return res.status(404).json({ error: 'Course not found' });
//     }

//     // permissions: only author or super admin can delete
//     const isSuperAdmin = userRole === 'super_admin';
//     const isAuthor = course.createdBy === userEmail;

//     if (!isSuperAdmin && !isAuthor) {
//       return res.status(403).json({
//         error: 'You do not have permission to delete this course',
//         message: 'Only the course author or super admins can delete courses'
//       });
//     }

//     // delete from DB
//     await Course.deleteOne({ projectId: id });

//     // delete synced folder
//     const courseDir = path.join(__dirname, '../../client/public/docs', id);
//     await fs.rm(courseDir, { recursive: true, force: true });

//     console.log(`🗑️ Course deleted: ${id} by ${userEmail}`);

//     // free up the courseId for reuse
//     await freeCourseId(id);

//     res.json({ success: true, message: 'Course deleted successfully' });

//   } catch (error) {
//     console.error('Error deleting course:', error);
//     res.status(500).json({ error: 'Failed to delete course: ' + error.message });
//   }
// });

// // GET /api/courses/:id/info
// router.get('/:id/info', async (req, res) => {
//   try {
//     const { id } = req.params;
//     const course = await Course.findOne({ projectId: id });
    
//     if (!course) {
//       return res.status(404).json({ error: 'Course not found' });
//     }
    
//     res.json({
//       course: {
//         title: course.title,
//         description: course.description,
//         keywords: course.keywords,
//         createdBy: course.createdBy,
//         createdAt: course.createdAt,
//         lastModifiedBy: course.lastModifiedBy,
//         lastModifiedAt: course.lastModifiedAt,
//         collaborators: course.collaborators
//       }
//     });
    
//   } catch (error) {
//     console.error('Error getting course info:', error);
//     res.status(500).json({ error: 'Failed to get course info' });
//   }
// });

// // PUT /api/courses/:id/info
// router.put('/:id/info', verifyAdmin, async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { title, description, keywords } = req.body;
    
//     const course = await Course.findOne({ projectId: id });
    
//     if (!course) {
//       return res.status(404).json({ error: 'Course not found' });
//     }
    
//     // Check permissions
//     if (!course.canEditInfo(req.admin.email, req.admin.role)) {
//       return res.status(403).json({ 
//         error: 'You do not have permission to edit course information',
//         message: 'Only the course author or super admins can edit course info'
//       });
//     }
    
//     // Update course info
//     if (title) course.title = title;
//     if (description !== undefined) course.description = description;
//     if (keywords !== undefined) {
//       course.keywords = Array.isArray(keywords) 
//         ? keywords 
//         : (keywords ? keywords.split(',').map(k => k.trim()) : []);
//     }
    
//     course.lastModifiedBy = req.admin.email;
//     course.lastModifiedAt = new Date();
    
//     await course.save();
    
//     // Sync to disk and update index.json
//     await syncFilesToDisk(course);
//     await updateIndexJson();
    
//     console.log(`✅ Course info updated: ${id} by ${req.admin.email}`);
    
//     res.json({ success: true, message: 'Course info updated' });
    
//   } catch (error) {
//     console.error('Error updating course info:', error);
//     res.status(500).json({ error: 'Failed to update course info' });
//   }
// });

// // PUT /api/courses/:id  => update README content (and metadata updates)
// router.put('/:id', verifyAdmin, async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { content } = req.body;
//     if (!content) return res.status(400).json({ error: 'Content is required' });

//     const course = await Course.findOne({ projectId: id });
//     if (!course) return res.status(404).json({ error: 'Course not found' });

//     if (!course.canEditContent(req.admin.email, req.admin.role)) {
//       return res.status(403).json({ error: 'You do not have permission to edit this course content' });
//     }

//     // Write README.md to disk
//     const readmePath = path.join(DOCS_ROOT, id, 'README.md');
//     await fs.writeFile(readmePath, content, 'utf8');

//     // regenerate sidebar from README file -> simple header extraction
//     // (optional: you can create a more sophisticated generator later)
//     const lines = content.split('\n');
//     const headers = [];
//     for (const line of lines) {
//       const m = line.match(/^##\s+(.+)$/);
//       if (m) {
//         const title = m[1].trim();
//         const anchor = title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');
//         headers.push(`* [${title}](README.md#${anchor})`);
//       }
//     }
//     const sidebar = headers.length > 0 ? headers.join('\n') : '* [Home](README.md)';
//     await fs.writeFile(path.join(DOCS_ROOT, id, '_sidebar.md'), sidebar, 'utf8');

//     course.lastModifiedBy = req.admin.email;
//     course.lastModifiedAt = new Date();
//     await course.save();

//     await updateIndexJson();

//     console.log(`✅ Course content updated and written to disk: ${id} by ${req.admin.email}`);
//     res.json({ success: true, message: 'Course content updated successfully' });

//   } catch (error) {
//     console.error('Error updating course:', error);
//     res.status(500).json({ error: 'Failed to update course: ' + error.message });
//   }
// });

// // PUT /api/courses/:id
// // router.put('/:id', verifyAdmin, async (req, res) => {
// //   try {
// //     const { id } = req.params;
// //     const { content } = req.body;

// //     if (!content) {
// //       return res.status(400).json({ error: 'Content is required' });
// //     }

// //     const course = await Course.findOne({ projectId: id });
    
// //     if (!course) {
// //       return res.status(404).json({ error: 'Course not found' });
// //     }
    
// //     // Check permissions
// //     if (!course.canEditContent(req.admin.email, req.admin.role)) {
// //       return res.status(403).json({ 
// //         error: 'You do not have permission to edit this course content',
// //         message: 'Only the course author, collaborators, or super admins can edit content'
// //       });
// //     }

// //     // Update content in MongoDB
// //     course.readmeContent = content;
// //     course.generateSidebar();
// //     course.lastModifiedBy = req.admin.email;
// //     course.lastModifiedAt = new Date();
    
// //     await course.save();
    
// //     // Sync to disk
// //     await syncFilesToDisk(course);
// //     await updateIndexJson();

// //     console.log(`✅ Course content updated: ${id} by ${req.admin.email}`);

// //     res.json({ success: true, message: 'Course content updated successfully' });

// //   } catch (error) {
// //     console.error('Error updating course:', error);
// //     res.status(500).json({ error: 'Failed to update course: ' + error.message });
// //   }
// // });

// // POST /api/courses/:id/upload-readme
// router.post('/:id/upload-readme', verifyAdmin, upload.single('readme'), async (req, res) => {
//   try {
//     const { id } = req.params;
//     if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

//     const course = await Course.findOne({ projectId: id });
//     if (!course) return res.status(404).json({ error: 'Course not found' });

//     if (!course.canEditContent(req.admin.email, req.admin.role)) {
//       return res.status(403).json({ error: 'You do not have permission to edit this course content' });
//     }

//     const content = req.file.buffer.toString('utf8');
//     await fs.writeFile(path.join(DOCS_ROOT, id, 'README.md'), content, 'utf8');

//     // regenerate sidebar
//     const lines = content.split('\n');
//     const headers = [];
//     for (const line of lines) {
//       const m = line.match(/^##\s+(.+)$/);
//       if (m) {
//         const title = m[1].trim();
//         const anchor = title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');
//         headers.push(`* [${title}](README.md#${anchor})`);
//       }
//     }
//     const sidebar = headers.length > 0 ? headers.join('\n') : '* [Home](README.md)';
//     await fs.writeFile(path.join(DOCS_ROOT, id, '_sidebar.md'), sidebar, 'utf8');

//     course.lastModifiedBy = req.admin.email;
//     course.lastModifiedAt = new Date();
//     await course.save();

//     await updateIndexJson();

//     res.json({ success: true, message: 'README uploaded and written to disk' });
//   } catch (error) {
//     console.error('Error uploading README:', error);
//     res.status(500).json({ error: 'Failed to upload README: ' + error.message });
//   }
// });


// // GET /api/courses/:id/download
// router.get('/:id/download', async (req, res) => {
//   try {
//     const { id } = req.params;
//     const course = await Course.findOne({ projectId: id });

//     if (!course) {
//       return res.status(404).json({ error: 'Course not found' });
//     }

//     // Create temporary file
//     const tempPath = path.join(__dirname, '../temp', `${id}_README.md`);
//     const tempDir = path.join(__dirname, '../temp');
    
//     await fs.mkdir(tempDir, { recursive: true });
//     await fs.writeFile(tempPath, course.readmeContent);

//     res.download(tempPath, `${id}_README.md`, async (err) => {
//       // Clean up temp file
//       try {
//         await fs.unlink(tempPath);
//       } catch (e) {}
      
//       if (err) {
//         console.error('Error downloading file:', err);
//         res.status(500).json({ error: 'Failed to download file' });
//       }
//     });

//   } catch (error) {
//     console.error('Error downloading README:', error);
//     res.status(500).json({ error: 'Failed to download README' });
//   }
// });

// // ============================================
// // COLLABORATOR MANAGEMENT ROUTES
// // ============================================

// // POST /api/courses/:id/collaborators
// router.post('/:id/collaborators', verifyAdmin, async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { email } = req.body;
    
//     if (!email || !email.trim()) {
//       return res.status(400).json({ error: 'Email is required' });
//     }
    
//     const collaboratorEmail = email.trim().toLowerCase();
    
//     if (collaboratorEmail === req.admin.email) {
//       return res.status(400).json({ error: 'You cannot add yourself as a collaborator' });
//     }
    
//     const course = await Course.findOne({ projectId: id });
    
//     if (!course) {
//       return res.status(404).json({ error: 'Course not found' });
//     }
    
//     // Check permissions
//     if (!course.canEditInfo(req.admin.email, req.admin.role)) {
//       return res.status(403).json({ 
//         error: 'You do not have permission to manage collaborators'
//       });
//     }
    
//     // Check if already a collaborator
//     const existingCollab = course.collaborators.find(c => c.email === collaboratorEmail);
//     if (existingCollab) {
//       return res.status(400).json({ 
//         error: `${collaboratorEmail} is already a collaborator (status: ${existingCollab.status})` 
//       });
//     }
    
//     // Check if user exists
//     const existingUser = await User.findOne({ email: collaboratorEmail });
    
//     if (existingUser) {
//       // User exists - add as collaborator with pending status
//       const token = crypto.randomBytes(32).toString('hex');
//       const now = new Date();
      
//       course.collaborators.push({
//         email: collaboratorEmail,
//         status: 'pending',
//         addedBy: req.admin.email,
//         addedAt: now,
//         inviteToken: token
//       });
      
//       await course.save();
//       await updateIndexJson();
      
//       // Create invitation record
//       const invites = await loadInvites();
//       invites.push({
//         id: `invite_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
//         courseId: id,
//         courseTitle: course.title,
//         invitedEmail: collaboratorEmail,
//         invitedBy: req.admin.email,
//         inviterName: req.admin.name,
//         status: 'pending',
//         token,
//         createdAt: now.toISOString(),
//         expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
//       });
//       await saveInvites(invites);
      
//       // Send email
//       const acceptLink = `${process.env.CLIENT_URL}/invite/accept?token=${token}`;
      
//       await sendEmail({
//         to: collaboratorEmail,
//         subject: `Collaboration Invitation: ${course.title}`,
//         html: `
//           <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
//             <h2 style="color: #646cff;">Course Collaboration Invitation</h2>
//             <p>Hello ${existingUser.name},</p>
//             <p><strong>${req.admin.name}</strong> (${req.admin.email}) has invited you to collaborate on the course:</p>
//             <h3 style="color: #333;">${course.title}</h3>
//             ${course.description ? `<p style="color: #666;">${course.description}</p>` : ''}
//             <p>As a collaborator, you will be able to:</p>
//             <ul>
//               <li>✅ Edit course content</li>
//               <li>✅ Upload and modify README files</li>
//               <li>✅ Update course materials</li>
//             </ul>
//             <p>Click the button below to accept this invitation:</p>
//             <a href="${acceptLink}" 
//                style="display: inline-block; padding: 12px 24px; background: #646cff; color: white; text-decoration: none; border-radius: 8px; margin: 20px 0;">
//               Accept Invitation
//             </a>
//             <p style="color: #666; font-size: 12px;">This invitation expires in 7 days.</p>
//           </div>
//         `
//       });
      
//       console.log(`✅ Collaboration invite sent to existing user ${collaboratorEmail} for course ${id}`);
      
//       return res.json({ 
//         success: true, 
//         message: `Invitation sent to ${collaboratorEmail}`,
//         userExists: true,
//         collaborator: {
//           email: collaboratorEmail,
//           status: 'pending',
//           addedAt: now
//         }
//       });
      
//     } else {
//       // User doesn't exist - create pending invitation
//       const inviteToken = crypto.randomBytes(32).toString('hex');
//       const now = new Date();
//       const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      
//       const pendingInvites = await loadPendingUserInvitations();
//       const existingInvite = pendingInvites.find(
//         inv => inv.email === collaboratorEmail && inv.courseId === id && inv.status === 'pending'
//       );
      
//       if (existingInvite) {
//         return res.status(400).json({ error: 'Invitation already sent to this email' });
//       }
      
//       pendingInvites.push({
//         id: `user_invite_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
//         email: collaboratorEmail,
//         courseId: id,
//         courseTitle: course.title,
//         invitedBy: req.admin.email,
//         inviterName: req.admin.name,
//         token: inviteToken,
//         createdAt: now.toISOString(),
//         expiresAt: expiresAt.toISOString(),
//         status: 'pending'
//       });
//       await savePendingUserInvitations(pendingInvites);
      
//       const registerLink = `${process.env.CLIENT_URL}/register?invite=${inviteToken}`;
      
//       await sendEmail({
//         to: collaboratorEmail,
//         subject: `You're invited to collaborate on "${course.title}"`,
//         html: `
//           <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
//             <h2 style="color: #646cff;">🎓 Course Collaboration Invitation</h2>
//             <p>Hello!</p>
//             <p><strong>${req.admin.name}</strong> has invited you to collaborate on the course:</p>
//             <h3 style="color: #333;">${course.title}</h3>
//             ${course.description ? `<p style="color: #666;">${course.description}</p>` : ''}
//             <p>As a collaborator, you will be able to edit course content and materials.</p>
//             <p><strong>To accept this invitation, you need to create a LearnHub account first:</strong></p>
//             <a href="${registerLink}" 
//                style="display: inline-block; padding: 12px 24px; background: #667eea; color: white; text-decoration: none; border-radius: 8px; margin: 20px 0;">
//               Create Account & Accept Invitation
//             </a>
//             <p style="color: #666; font-size: 12px;">This invitation expires in 7 days.</p>
//           </div>
//         `
//       });
      
//       console.log(`✅ Registration invitation sent to ${collaboratorEmail} for course ${id}`);
      
//       return res.json({ 
//         success: true, 
//         message: `Invitation sent to ${collaboratorEmail}. They need to register first.`,
//         userExists: false,
//         requiresRegistration: true
//       });
//     }
    
//   } catch (error) {
//     console.error('Error adding collaborator:', error);
//     res.status(500).json({ error: 'Failed to add collaborator: ' + error.message });
//   }
// });

// // DELETE /api/courses/:id/collaborators/:email
// router.delete('/:id/collaborators/:email', verifyAdmin, async (req, res) => {
//   try {
//     const { id, email } = req.params;
    
//     const course = await Course.findOne({ projectId: id });
    
//     if (!course) {
//       return res.status(404).json({ error: 'Course not found' });
//     }
    
//     // Check permissions
//     if (!course.canEditInfo(req.admin.email, req.admin.role)) {
//       return res.status(403).json({ 
//         error: 'You do not have permission to manage collaborators'
//       });
//     }
    
//     const originalLength = course.collaborators.length;
//     course.collaborators = course.collaborators.filter(c => c.email !== email);
    
//     if (course.collaborators.length === originalLength) {
//       return res.status(404).json({ error: 'Collaborator not found' });
//     }
    
//     await course.save();
//     await updateIndexJson();
    
//     // Remove pending invite if exists
//     const invites = await loadInvites();
//     const updatedInvites = invites.filter(inv => 
//       !(inv.courseId === id && inv.invitedEmail === email && inv.status === 'pending')
//     );
//     await saveInvites(updatedInvites);
    
//     console.log(`✅ Collaborator ${email} removed from course ${id}`);
    
//     res.json({ success: true, message: 'Collaborator removed' });
    
//   } catch (error) {
//     console.error('Error removing collaborator:', error);
//     res.status(500).json({ error: 'Failed to remove collaborator' });
//   }
// });

// // GET /api/courses/:id/pending-user-invitations
// router.get('/:id/pending-user-invitations', verifyAdmin, async (req, res) => {
//   try {
//     const { id } = req.params;
    
//     const course = await Course.findOne({ projectId: id });
    
//     if (!course) {
//       return res.status(404).json({ error: 'Course not found' });
//     }
    
//     // Check permissions
//     if (!course.canEditInfo(req.admin.email, req.admin.role)) {
//       return res.status(403).json({ 
//         error: 'You do not have permission to view invitations'
//       });
//     }
    
//     const pendingInvites = await loadPendingUserInvitations();
//     const courseInvites = pendingInvites.filter(
//       inv => inv.courseId === id && inv.status === 'pending' && new Date(inv.expiresAt) > new Date()
//     );
    
//     res.json({ invitations: courseInvites });
    
//   } catch (error) {
//     console.error('Error fetching pending user invitations:', error);
//     res.status(500).json({ error: 'Failed to fetch invitations' });
//   }
// });

// // DELETE /api/courses/:id/pending-user-invitations/:email
// router.delete('/:id/pending-user-invitations/:email', verifyAdmin, async (req, res) => {
//   try {
//     const { id, email } = req.params;
    
//     const course = await Course.findOne({ projectId: id });
    
//     if (!course) {
//       return res.status(404).json({ error: 'Course not found' });
//     }
    
//     // Check permissions
//     if (!course.canEditInfo(req.admin.email, req.admin.role)) {
//       return res.status(403).json({ 
//         error: 'You do not have permission to manage invitations'
//       });
//     }
    
//     const pendingInvites = await loadPendingUserInvitations();
//     const filteredInvites = pendingInvites.filter(
//       inv => !(inv.courseId === id && inv.email === decodeURIComponent(email) && inv.status === 'pending')
//     );
    
//     if (filteredInvites.length === pendingInvites.length) {
//       return res.status(404).json({ error: 'Invitation not found' });
//     }
    
//     await savePendingUserInvitations(filteredInvites);
    
//     console.log(`✅ Pending user invitation cancelled for ${email} on course ${id}`);
    
//     res.json({ success: true, message: 'Invitation cancelled' });
    
//   } catch (error) {
//     console.error('Error cancelling invitation:', error);
//     res.status(500).json({ error: 'Failed to cancel invitation' });
//   }
// });

// // GET /api/courses/invitations/verify/:token
// router.get('/invitations/verify/:token', async (req, res) => {
//   try {
//     const { token } = req.params;

//     const invitations = await loadPendingUserInvitations();
//     const invitation = invitations.find(
//       inv => inv.token === token && inv.status === 'pending' && new Date(inv.expiresAt) > new Date()
//     );

//     if (!invitation) {
//       return res.status(404).json({ 
//         valid: false, 
//         error: 'Invalid or expired invitation' 
//       });
//     }

//     res.json({
//       valid: true,
//       email: invitation.email,
//       courseName: invitation.courseTitle,
//       invitedBy: invitation.inviterName,
//       courseId: invitation.courseId
//     });

//   } catch (error) {
//     console.error('Error verifying invitation:', error);
//     res.status(500).json({ error: 'Failed to verify invitation' });
//   }
// });

// // POST /api/courses/invitations/accept
// router.post('/invitations/accept', verifyAdmin, async (req, res) => {
//   try {
//     const { token } = req.body;
//     const userEmail = req.admin.email;

//     const invitations = await loadPendingUserInvitations();
//     const inviteIndex = invitations.findIndex(
//       inv => inv.token === token && inv.email === userEmail && inv.status === 'pending' && new Date(inv.expiresAt) > new Date()
//     );

//     if (inviteIndex === -1) {
//       return res.status(404).json({ error: 'Invalid or expired invitation' });
//     }

//     const invitation = invitations[inviteIndex];

//     // Add user as collaborator to the course in MongoDB
//     const course = await Course.findOne({ projectId: invitation.courseId });
    
//     if (!course) {
//       return res.status(404).json({ error: 'Course not found' });
//     }
    
//     const existingCollab = course.collaborators.find(c => c.email === userEmail);
//     if (!existingCollab) {
//       course.collaborators.push({
//         email: userEmail,
//         addedBy: invitation.invitedBy,
//         addedAt: new Date(),
//         status: 'accepted'
//       });
      
//       await course.save();
//       await updateIndexJson();
//     }

//     // Mark invitation as accepted
//     invitations[inviteIndex].status = 'accepted';
//     invitations[inviteIndex].acceptedAt = new Date().toISOString();
//     await savePendingUserInvitations(invitations);

//     // Notify course author
//     await sendEmail({
//       to: invitation.invitedBy,
//       subject: `${userEmail} accepted your collaboration invitation`,
//       html: `
//         <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
//           <h2 style="color: #646cff;">✅ Collaborator Accepted</h2>
//           <p>Good news!</p>
//           <p><strong>${userEmail}</strong> has accepted your invitation and is now a collaborator on:</p>
//           <h3 style="color: #333;">${invitation.courseTitle}</h3>
//           <p>They can now start editing the course content.</p>
//         </div>
//       `
//     });

//     console.log(`✅ User ${userEmail} accepted invitation for course ${invitation.courseId}`);

//     res.json({ 
//       success: true, 
//       message: 'Successfully added as collaborator',
//       courseId: invitation.courseId
//     });

//   } catch (error) {
//     console.error('Error accepting invitation:', error);
//     res.status(500).json({ error: 'Failed to accept invitation' });
//   }
// });

// // ============================================
// // IMAGE MANAGEMENT ROUTES
// // ============================================

// // Configure multer for image uploads
// const imageStorage = multer.diskStorage({
//   destination: (req, file, cb) => {
//     const courseId = req.params.id;
//     const uploadDir = path.join(__dirname, '../../client/public/docs', courseId, 'images');
    
//     const fsSync = require('fs');
//     fsSync.mkdirSync(uploadDir, { recursive: true });
//     cb(null, uploadDir);
//   },
//   filename: (req, file, cb) => {
//     const uniqueName = `${Date.now()}-${file.originalname}`;
//     cb(null, uniqueName);
//   }
// });

// const imageUpload = multer({ 
//   storage: imageStorage,
//   limits: { fileSize: 5 * 1024 * 1024 },
//   fileFilter: (req, file, cb) => {
//     if (file.mimetype.startsWith('image/')) {
//       cb(null, true);
//     } else {
//       cb(new Error('Only image files are allowed'));
//     }
//   }
// });

// // POST /api/courses/:id/images
// router.post('/:id/images', verifyAdmin, imageUpload.array('images', 10), async (req, res) => {
//   try {
//     const { id } = req.params;
    
//     const course = await Course.findOne({ projectId: id });
    
//     if (!course) {
//       return res.status(404).json({ error: 'Course not found' });
//     }
    
//     // Check permissions
//     if (!course.canEditContent(req.admin.email, req.admin.role)) {
//       return res.status(403).json({ 
//         error: 'You do not have permission to upload images'
//       });
//     }
    
//     if (!req.files || req.files.length === 0) {
//       return res.status(400).json({ error: 'No images uploaded' });
//     }

//     const uploadedFiles = req.files.map(file => file.filename);
    
//     console.log(`✅ ${uploadedFiles.length} image(s) uploaded for course ${id}`);
    
//     res.json({ 
//       success: true, 
//       message: `${uploadedFiles.length} image(s) uploaded successfully`,
//       images: uploadedFiles
//     });

//   } catch (error) {
//     console.error('Error uploading images:', error);
//     res.status(500).json({ error: 'Failed to upload images: ' + error.message });
//   }
// });

// // GET /api/courses/:id/images
// router.get('/:id/images', async (req, res) => {
//   try {
//     const { id } = req.params;
//     const imagesDir = path.join(__dirname, '../../client/public/docs', id, 'images');

//     try {
//       const files = await fs.readdir(imagesDir);
//       const imageFiles = files.filter(file => {
//         const ext = path.extname(file).toLowerCase();
//         return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'].includes(ext);
//       });
      
//       res.json({ success: true, images: imageFiles });
//     } catch (err) {
//       res.json({ success: true, images: [] });
//     }

//   } catch (error) {
//     console.error('Error listing images:', error);
//     res.status(500).json({ error: 'Failed to list images' });
//   }
// });

// // GET /api/courses/:id/images/:name
// router.get('/:id/images/:name', async (req, res) => {
//   try {
//     const { id, name } = req.params;
//     const imagePath = path.join(__dirname, '../../client/public/docs', id, 'images', name);

//     try {
//       await fs.access(imagePath);
//       res.sendFile(imagePath);
//     } catch (err) {
//       res.status(404).json({ error: 'Image not found' });
//     }

//   } catch (error) {
//     console.error('Error serving image:', error);
//     res.status(500).json({ error: 'Failed to serve image' });
//   }
// });

// // DELETE /api/courses/:id/images/:name
// router.delete('/:id/images/:name', verifyAdmin, async (req, res) => {
//   try {
//     const { id, name } = req.params;
    
//     const course = await Course.findOne({ projectId: id });
    
//     if (!course) {
//       return res.status(404).json({ error: 'Course not found' });
//     }
    
//     // Check permissions
//     if (!course.canEditContent(req.admin.email, req.admin.role)) {
//       return res.status(403).json({ 
//         error: 'You do not have permission to delete images'
//       });
//     }
    
//     const imagePath = path.join(__dirname, '../../client/public/docs', id, 'images', name);

//     try {
//       await fs.unlink(imagePath);
//       console.log(`✅ Image deleted: ${name} from course ${id}`);
//       res.json({ success: true, message: 'Image deleted successfully' });
//     } catch (err) {
//       res.status(404).json({ error: 'Image not found' });
//     }

//   } catch (error) {
//     console.error('Error deleting image:', error);
//     res.status(500).json({ error: 'Failed to delete image' });
//   }
// });

// module.exports = router;
