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



// Helper: Load collaboration invites
async function loadInvites() {
  const invitesPath = path.join(__dirname, '../../data/collaboration_invites.json');
  try {
    const content = await fs.readFile(invitesPath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    return [];
  }
}

// Helper: Save collaboration invites
async function saveInvites(invites) {
  const invitesPath = path.join(__dirname, '../../data/collaboration_invites.json');
  const dataDir = path.join(__dirname, '../../data');
  
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

// POST /api/courses/create
router.post('/create', verifyAdmin, upload.none(), async (req, res) => {
  try {
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

    // Create README WITHOUT metadata - just content
    const readmeContent = `# ${title}

Start writing your course content here...
`;

    // Generate sidebar
    const sidebarContent = generateSidebar(readmeContent);

    // Generate index.html
    const indexContent = generateIndexHtml(title);

    // Write all files
    await fs.writeFile(path.join(courseDir, 'README.md'), readmeContent);
    await fs.writeFile(path.join(courseDir, '_sidebar.md'), sidebarContent);
    await fs.writeFile(path.join(courseDir, 'index.html'), indexContent);

    // Update index.json with metadata tracking
    await updateIndexJson(docsDir, courseId, title, description || '', keywords || '', req.admin.email, false);

    console.log(`✅ Course created: ${courseId} by ${req.admin.email}`);

    res.json({
      success: true,
      message: 'Course created successfully',
      course: { id: courseId, title, description, keywords }
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
    
    // Generate invitation token
    const token = crypto.randomBytes(32).toString('hex');
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days
    
    // Add pending collaborator to course
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
      createdAt: now,
      expiresAt
    });
    await saveInvites(invites);
    
    // Send invitation email
    const acceptLink = `${process.env.CLIENT_URL}/invite/accept?token=${token}`;
    
    await sendEmail({
      to: collaboratorEmail,
      subject: `Collaboration Invitation: ${course.title}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #646cff;">Course Collaboration Invitation</h2>
          <p>Hello,</p>
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
          <p style="color: #666; font-size: 12px;">If you don't want to collaborate, simply ignore this email.</p>
        </div>
      `
    });
    
    console.log(`✅ Collaboration invite sent to ${collaboratorEmail} for course ${id}`);
    
    res.json({ 
      success: true, 
      message: `Invitation sent to ${collaboratorEmail}`,
      collaborator: {
        email: collaboratorEmail,
        status: 'pending',
        addedAt: now
      }
    });
    
  } catch (error) {
    console.error('Error adding collaborator:', error);
    res.status(500).json({ error: 'Failed to add collaborator: ' + error.message });
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

module.exports = router;

// const express = require('express');
// const path = require('path');
// const fs = require('fs').promises;
// const { verifyAdmin } = require('../middleware/auth');
// const multer = require('multer');

// const router = express.Router();
// const storage = multer.memoryStorage();
// const upload = multer({ storage });

// // Helper: Generate course ID from title
// function generateCourseId(title) {
//   return title
//     .toLowerCase()
//     .replace(/[^a-z0-9\s-]/g, '')
//     .trim()
//     .replace(/\s+/g, '-')
//     .slice(0, 50);
// }

// // Helper: Generate _sidebar.md from README headers
// function generateSidebar(readmeContent) {
//   const lines = readmeContent.split('\n');
//   const headers = [];

//   for (const line of lines) {
//     const h2Match = line.match(/^##\s+(.+)$/);
//     if (h2Match) {
//       const title = h2Match[1].trim();
//       const anchor = title
//         .toLowerCase()
//         .replace(/[^a-z0-9\s-]/g, '')
//         .replace(/\s+/g, '-');
//       headers.push(`* [${title}](README.md#${anchor})`);
//     }
//   }

//   return headers.length > 0 ? headers.join('\n') : '* [Home](README.md)';
// }

// // Helper: Generate index.html
// function generateIndexHtml(title) {
//   return `<!DOCTYPE html>
// <html>
// <head>
//   <meta charset="UTF-8">
//   <title>${title}</title>
//   <meta name="viewport" content="width=device-width, initial-scale=1">
//   <link rel="stylesheet" href="//cdn.jsdelivr.net/npm/docsify@4/lib/themes/vue.css">
// </head>
// <body>
//   <div id="app">Loading...</div>

//   <script>
//     window.$docsify = {
//       name: '${title}',
//       repo: '',
//       loadSidebar: true,
//       subMaxLevel: 2,
//       loadNavbar: false,
//       copyCode: {
//         buttonText: '📋 Copy',
//         errorText: '✖ Failed',
//         successText: '✓ Copied!'
//       },
//     };
//   </script>

//   <script src="//cdn.jsdelivr.net/npm/docsify@4"></script>
//   <script src="//cdn.jsdelivr.net/npm/docsify-copy-code"></script>
// </body>
// </html>`;
// }

// // Helper: Update index.json with full metadata tracking
// async function updateIndexJson(docsDir, courseId, title, description, keywords = [], adminEmail, isUpdate = false) {
//   const indexPath = path.join(docsDir, 'index.json');
  
//   let courses = [];
//   try {
//     const content = await fs.readFile(indexPath, 'utf-8');
//     courses = JSON.parse(content);
//   } catch (err) {
//     console.log('Creating new index.json');
//   }

//   const existing = courses.findIndex(c => c.proj === courseId);
//   const now = new Date().toISOString();
  
//   let courseData;
  
//   if (existing >= 0 && isUpdate) {
//     // Update existing course - preserve creation info
//     courseData = {
//       ...courses[existing],
//       title,
//       description,
//       keywords: Array.isArray(keywords) ? keywords : (keywords ? keywords.split(',').map(k => k.trim()).filter(Boolean) : []),
//       lastModifiedBy: adminEmail,
//       lastModifiedAt: now
//     };
//     courses[existing] = courseData;
//   } else if (existing >= 0) {
//     // Replace existing (shouldn't happen in normal flow)
//     courseData = {
//       proj: courseId,
//       title,
//       description,
//       keywords: Array.isArray(keywords) ? keywords : (keywords ? keywords.split(',').map(k => k.trim()).filter(Boolean) : []),
//       createdBy: courses[existing].createdBy || adminEmail,
//       createdAt: courses[existing].createdAt || now,
//       lastModifiedBy: adminEmail,
//       lastModifiedAt: now
//     };
//     courses[existing] = courseData;
//   } else {
//     // New course
//     courseData = {
//       proj: courseId,
//       title,
//       description,
//       keywords: Array.isArray(keywords) ? keywords : (keywords ? keywords.split(',').map(k => k.trim()).filter(Boolean) : []),
//       createdBy: adminEmail,
//       createdAt: now,
//       lastModifiedBy: adminEmail,
//       lastModifiedAt: now
//     };
//     courses.push(courseData);
//   }

//   courses.sort((a, b) => a.proj.localeCompare(b.proj));
//   await fs.writeFile(indexPath, JSON.stringify(courses, null, 2));
// }

// // POST /api/courses/create
// // Create a new course (admin only)
// router.post('/create', verifyAdmin, upload.none(), async (req, res) => {
//   try {
//     const { title, description, keywords } = req.body;

//     if (!title) {
//       return res.status(400).json({ error: 'Title is required' });
//     }

//     const courseId = generateCourseId(title);
//     const docsDir = path.join(__dirname, '../../client/public/docs');
//     const courseDir = path.join(docsDir, courseId);

//     // Check if course already exists
//     try {
//       await fs.access(courseDir);
//       return res.status(400).json({ error: 'Course with this title already exists' });
//     } catch (err) {
//       // Course doesn't exist, continue
//     }

//     // Create course directory
//     await fs.mkdir(courseDir, { recursive: true });

//     // Create README WITHOUT metadata - just content
//     const readmeContent = `# ${title}

// Start writing your course content here...
// `;

//     // Generate sidebar
//     const sidebarContent = generateSidebar(readmeContent);

//     // Generate index.html
//     const indexContent = generateIndexHtml(title);

//     // Write all files
//     await fs.writeFile(path.join(courseDir, 'README.md'), readmeContent);
//     await fs.writeFile(path.join(courseDir, '_sidebar.md'), sidebarContent);
//     await fs.writeFile(path.join(courseDir, 'index.html'), indexContent);

//     // Update index.json with metadata tracking
//     await updateIndexJson(docsDir, courseId, title, description || '', keywords || '', req.admin.email, false);

//     console.log(`✅ Course created: ${courseId} by ${req.admin.email}`);

//     res.json({
//       success: true,
//       message: 'Course created successfully',
//       course: { id: courseId, title, description, keywords }
//     });

//   } catch (error) {
//     console.error('Error creating course:', error);
//     res.status(500).json({ error: 'Failed to create course: ' + error.message });
//   }
// });

// // GET /api/courses
// // Get all courses
// router.get('/', async (req, res) => {
//   try {
//     const docsDir = path.join(__dirname, '../../client/public/docs');
//     const indexPath = path.join(docsDir, 'index.json');

//     const content = await fs.readFile(indexPath, 'utf-8');
//     const courses = JSON.parse(content);

//     res.json({ courses });
//   } catch (error) {
//     console.error('Error fetching courses:', error);
//     res.status(500).json({ error: 'Failed to fetch courses' });
//   }
// });

// // GET /api/courses/:id
// // Get course content for editing
// router.get('/:id', async (req, res) => {
//   try {
//     const { id } = req.params;
//     const docsDir = path.join(__dirname, '../../client/public/docs');
//     const readmePath = path.join(docsDir, id, 'README.md');

//     const content = await fs.readFile(readmePath, 'utf-8');

//     res.json({ success: true, content });
//   } catch (error) {
//     console.error('Error reading course:', error);
//     res.status(500).json({ error: 'Failed to read course content' });
//   }
// });

// // GET /api/courses/:id/download
// // Download course README file
// router.get('/:id/download', async (req, res) => {
//   try {
//     const { id } = req.params;
//     const docsDir = path.join(__dirname, '../../client/public/docs');
//     const readmePath = path.join(docsDir, id, 'README.md');

//     // Check if file exists
//     try {
//       await fs.access(readmePath);
//     } catch (err) {
//       return res.status(404).json({ error: 'README file not found' });
//     }

//     // Send file as download
//     res.download(readmePath, `${id}_README.md`, (err) => {
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

// // GET /api/courses/:id/info
// // Read course info from index.json ONLY
// router.get('/:id/info', async (req, res) => {
//   try {
//     const { id } = req.params;
//     const docsDir = path.join(__dirname, '../../client/public/docs');
//     const indexPath = path.join(docsDir, 'index.json');
    
//     // Read from index.json
//     const content = await fs.readFile(indexPath, 'utf-8');
//     const courses = JSON.parse(content);
//     const course = courses.find(c => c.proj === id);
    
//     if (!course) {
//       return res.status(404).json({ error: 'Course not found in index.json' });
//     }
    
//     res.json({
//       course: {
//         title: course.title || '',
//         description: course.description || '',
//         keywords: course.keywords ? (Array.isArray(course.keywords) ? course.keywords : course.keywords.split(',').map(k => k.trim())) : [],
//         createdBy: course.createdBy || 'Unknown',
//         createdAt: course.createdAt || new Date().toISOString(),
//         lastModifiedBy: course.lastModifiedBy || course.createdBy || 'Unknown',
//         lastModifiedAt: course.lastModifiedAt || course.createdAt || new Date().toISOString()
//       }
//     });
    
//   } catch (error) {
//     console.error('Error getting course info:', error);
//     res.status(500).json({ error: 'Failed to get course info' });
//   }
// });

// // PUT /api/courses/:id/info
// // Update course info in index.json ONLY
// router.put('/:id/info', verifyAdmin, async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { title, description, keywords } = req.body;
    
//     const docsDir = path.join(__dirname, '../../client/public/docs');
//     const indexPath = path.join(docsDir, 'index.json');
    
//     // Read index.json
//     let courses = [];
//     try {
//       const content = await fs.readFile(indexPath, 'utf-8');
//       courses = JSON.parse(content);
//     } catch (err) {
//       return res.status(500).json({ error: 'Failed to read index.json' });
//     }
    
//     // Find the course
//     const courseIndex = courses.findIndex(c => c.proj === id);
//     if (courseIndex === -1) {
//       return res.status(404).json({ error: 'Course not found in index.json' });
//     }
    
//     const existingCourse = courses[courseIndex];
//     const now = new Date().toISOString();
    
//     // Update course info in index.json with tracking
//     courses[courseIndex] = {
//       proj: id,
//       title: title || existingCourse.title,
//       description: description || '',
//       keywords: Array.isArray(keywords) ? keywords : (keywords ? keywords.split(',').map(k => k.trim()) : []),
//       createdBy: existingCourse.createdBy || req.admin.email,
//       createdAt: existingCourse.createdAt || now,
//       lastModifiedBy: req.admin.email,
//       lastModifiedAt: now
//     };
    
//     // Write back to index.json
//     await fs.writeFile(indexPath, JSON.stringify(courses, null, 2));
    
//     console.log(`✅ Course info updated in index.json: ${id} by ${req.admin.email}`);
    
//     res.json({ success: true, message: 'Course info updated in index.json' });
    
//   } catch (error) {
//     console.error('Error updating course info:', error);
//     res.status(500).json({ error: 'Failed to update course info' });
//   }
// });

// // POST /api/courses/:id/upload-readme
// // Upload a new README file (admin only)
// router.post('/:id/upload-readme', verifyAdmin, upload.single('readme'), async (req, res) => {
//   try {
//     const { id } = req.params;
    
//     if (!req.file) {
//       return res.status(400).json({ error: 'No file uploaded' });
//     }
    
//     const docsDir = path.join(__dirname, '../../client/public/docs');
//     const courseDir = path.join(docsDir, id);
//     const readmePath = path.join(courseDir, 'README.md');
//     const indexPath = path.join(docsDir, 'index.json');
    
//     // Check if course exists
//     try {
//       await fs.access(courseDir);
//     } catch (err) {
//       return res.status(404).json({ error: 'Course not found' });
//     }
    
//     // Write the uploaded file content (no metadata manipulation)
//     const content = req.file.buffer.toString('utf-8');
//     await fs.writeFile(readmePath, content);
    
//     // Regenerate sidebar from new content
//     const sidebarContent = generateSidebar(content);
//     await fs.writeFile(path.join(courseDir, '_sidebar.md'), sidebarContent);
    
//     // Update lastModified tracking in index.json
//     try {
//       const indexContent = await fs.readFile(indexPath, 'utf-8');
//       const courses = JSON.parse(indexContent);
//       const courseIndex = courses.findIndex(c => c.proj === id);
      
//       if (courseIndex >= 0) {
//         courses[courseIndex].lastModifiedBy = req.admin.email;
//         courses[courseIndex].lastModifiedAt = new Date().toISOString();
//         await fs.writeFile(indexPath, JSON.stringify(courses, null, 2));
//       }
//     } catch (err) {
//       console.error('Failed to update tracking in index.json:', err);
//     }
    
//     console.log(`✅ README uploaded for: ${id} by ${req.admin.email}`);
    
//     res.json({
//       success: true,
//       message: 'README uploaded successfully'
//     });
    
//   } catch (error) {
//     console.error('Error uploading README:', error);
//     res.status(500).json({ error: 'Failed to upload README: ' + error.message });
//   }
// });

// // PUT /api/courses/:id
// // Update course content (admin only)
// router.put('/:id', verifyAdmin, async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { content } = req.body;

//     if (!content) {
//       return res.status(400).json({ error: 'Content is required' });
//     }

//     const docsDir = path.join(__dirname, '../../client/public/docs');
//     const courseDir = path.join(docsDir, id);
//     const readmePath = path.join(courseDir, 'README.md');
//     const indexPath = path.join(docsDir, 'index.json');

//     // Write updated README (no metadata manipulation)
//     await fs.writeFile(readmePath, content);

//     // Regenerate sidebar from new content
//     const sidebarContent = generateSidebar(content);
//     await fs.writeFile(path.join(courseDir, '_sidebar.md'), sidebarContent);

//     // Update lastModified tracking in index.json
//     try {
//       const indexContent = await fs.readFile(indexPath, 'utf-8');
//       const courses = JSON.parse(indexContent);
//       const courseIndex = courses.findIndex(c => c.proj === id);
      
//       if (courseIndex >= 0) {
//         courses[courseIndex].lastModifiedBy = req.admin.email;
//         courses[courseIndex].lastModifiedAt = new Date().toISOString();
//         await fs.writeFile(indexPath, JSON.stringify(courses, null, 2));
//       }
//     } catch (err) {
//       console.error('Failed to update tracking in index.json:', err);
//     }

//     console.log(`✅ Course content updated: ${id} by ${req.admin.email}`);

//     res.json({
//       success: true,
//       message: 'Course content updated successfully'
//     });

//   } catch (error) {
//     console.error('Error updating course:', error);
//     res.status(500).json({ error: 'Failed to update course: ' + error.message });
//   }
// });

// module.exports = router;