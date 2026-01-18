// server/routes/programs.js
const express = require('express');
const { verifyAdmin } = require('../middleware/auth');
const Program = require('../models/Programs');
const ProgramId = require('../models/ProgramsId');
const Course = require('../models/Course');
const router = express.Router();
const Module = require('../models/Module');

// ============================================
// HELPER FUNCTIONS
// ============================================

// Helper: pad number to 4 digits
function padId(num) {
  return String(num).padStart(4, '0');
}

// Helper: slug generation
function generateSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 50);
}

// Assign next available program ID (P0001, P0002, etc.)
async function assignNextAvailableProgramId() {
  const doc = await ProgramId.findOne() || new ProgramId();
  const usedSet = new Set(doc.used || []);

  let candidate = 1;
  while (true) {
    const pid = 'P' + padId(candidate);
    if (!usedSet.has(pid)) {
      doc.used.push(pid);
      await doc.save();
      return pid;
    }
    candidate += 1;
    if (candidate > 9999) throw new Error('No available program IDs');
  }
}

// Free (make reusable) a programId
async function freeProgramId(programId) {
  const doc = await ProgramId.findOne();
  if (!doc) return;
  const idx = (doc.used || []).indexOf(programId);
  if (idx !== -1) {
    doc.used.splice(idx, 1);
    await doc.save();
  }
}

// ============================================
// PROGRAM CRUD ROUTES
// ============================================

// POST /api/programs/create
router.post('/create', verifyAdmin, async (req, res) => {
  try {
    const { 
      title, 
      description, 
      thumbnail, 
      duration, 
      difficulty, 
      category, 
      status,
      topicIds 
    } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    if (!topicIds || !Array.isArray(topicIds)) {
      return res.status(400).json({ error: 'Abn error occurred. Try again later.' });
    }

    // Verify all topics exist
    const topics = await Course.find({ projectId: { $in: topicIds } });
    if (topics.length !== topicIds.length) {
      return res.status(400).json({ error: 'One or more topics not found' });
    }

    // Assign program ID
    const programId = await assignNextAvailableProgramId();
    const slug = generateSlug(title);

    // Create new program
    const newProgram = new Program({
      programId,
      slug,
      title,
      description: description || '',
      thumbnail: thumbnail || '',
      duration: duration || '',
      difficulty: difficulty || 'Beginner',
      category: Array.isArray(category) ? category : [],
      status: status || 'draft',
      topicIds,
      createdBy: req.admin.email,
      lastModifiedBy: req.admin.email,
      collaborators: []
    });

    await newProgram.save();

    console.log(`✅ Program created: ${programId} by ${req.admin.email}`);

    res.json({
      success: true,
      message: 'Course created successfully',
      program: {
        programId: newProgram.programId,
        title: newProgram.title,
        description: newProgram.description,
        topicIds: newProgram.topicIds,
        difficulty: newProgram.difficulty,
        status: newProgram.status
      }
    });

  } catch (error) {
    console.error('Error creating program:', error);
    res.status(500).json({ error: 'Failed to create course: ' + error.message });
  }
});

// GET /api/programs - Get all programs (admins see all, public sees only published)
router.get('/', async (req, res) => {
  try {
    const isAdmin = req.headers.authorization;
    
    let query = {};
    // if (!isAdmin) {
    //   // Public users only see published programs
    //   query.status = 'published';
    // }

    const programs = await Program.find(query)
      .select('programId slug title description thumbnail duration difficulty category status topicIds createdBy createdAt lastModifiedBy lastModifiedAt collaborators')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      programs: programs.map(p => ({
        programId: p.programId,
        slug: p.slug,
        title: p.title,
        description: p.description,
        thumbnail: p.thumbnail,
        duration: p.duration,
        difficulty: p.difficulty,
        category: p.category,
        status: p.status,
        topicIds: p.topicIds,
        createdBy: p.createdBy,
        createdAt: p.createdAt,
        lastModifiedBy: p.lastModifiedBy,
        lastModifiedAt: p.lastModifiedAt,
        collaborators: p.collaborators
      }))
    });

  } catch (error) {
    console.error('Error fetching programs:', error);
    res.status(500).json({ error: 'Failed to fetch courses' });
  }
});

// GET /api/programs/:id - Get single program with modules
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const program = await Program.findOne({ programId: id });

    if (!program) {
      return res.status(404).json({ error: 'Course not found' });
    }

    // // If program is draft, only allow access to admins/collaborators
    // if (program.status === 'draft') {
    //   const isAdmin = req.headers.authorization;
    //   if (!isAdmin) {
    //     return res.status(403).json({ error: 'This course is not published yet' });
    //   }
    // }

    // ✅ NEW: Load modules if they exist
    let modulesWithTopics = [];
    
    if (program.modules && program.modules.length > 0) {
      // Import Module model at top of file if not already imported
      const Module = require('../models/Module');
      
      // Load each module with its topics
      const modulePromises = program.modules
        .sort((a, b) => a.order - b.order)
        .map(async (modRef) => {
          const module = await Module.findOne({ moduleId: modRef.moduleId });
          if (!module) return null;
          
          // Load topics for this module
          const topics = await Course.find({ 
            projectId: { $in: module.topicIds } 
          });
          
          return {
            moduleId: module.moduleId,
            title: module.title,
            description: module.description,
            order: module.order,
            topicIds: module.topicIds,
            topics: topics.map(t => ({
              proj: t.projectId,
              title: t.title,
              description: t.description,
              keywords: t.keywords
            }))
          };
        });
      
      modulesWithTopics = (await Promise.all(modulePromises)).filter(Boolean);
    }

    // Build response
    const response = {
      success: true,
      program: {
        programId: program.programId,
        slug: program.slug,
        title: program.title,
        description: program.description,
        thumbnail: program.thumbnail,
        duration: program.duration,
        difficulty: program.difficulty,
        category: program.category,
        status: program.status,
        topicIds: program.topicIds || [],
        modules: modulesWithTopics.length > 0 ? modulesWithTopics : undefined,
        createdBy: program.createdBy,
        createdAt: program.createdAt,
        lastModifiedBy: program.lastModifiedBy,
        lastModifiedAt: program.lastModifiedAt,
        collaborators: program.collaborators
      }
    };

    res.json(response);

  } catch (error) {
    console.error('Error fetching program:', error);
    res.status(500).json({ 
      error: 'Failed to fetch course',
      details: error.message 
    });
  }
});

// PUT /api/programs/:id - Update program
router.put('/:id', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      title, 
      description, 
      thumbnail, 
      duration, 
      difficulty, 
      category, 
      status,
      topicIds 
    } = req.body;

    const program = await Program.findOne({ programId: id });

    if (!program) {
      return res.status(404).json({ error: 'Course not found' });
    }

    // Check permissions
    if (!program.canEditInfo(req.admin.email, req.admin.role)) {
      return res.status(403).json({ 
        error: 'You do not have permission to edit this course'
      });
    }

    // Update fields
    if (title) program.title = title;
    if (description !== undefined) program.description = description;
    if (thumbnail !== undefined) program.thumbnail = thumbnail;
    if (duration !== undefined) program.duration = duration;
    if (difficulty) program.difficulty = difficulty;
    if (category !== undefined) program.category = Array.isArray(category) ? category : [];
    if (status) program.status = status;
    
    if (topicIds && Array.isArray(topicIds)) {
      // if (topicIds.length < 2) {
      //   return res.status(400).json({ error: 'At least 2 topics are required' });
      // }
      
      // Verify all topics exist
      const topics = await Course.find({ projectId: { $in: topicIds } });
      if (topics.length !== topicIds.length) {
        return res.status(400).json({ error: 'One or more topics not found' });
      }
      
      program.topicIds = topicIds;
    }

    program.lastModifiedBy = req.admin.email;
    program.lastModifiedAt = new Date();

    await program.save();

    console.log(`✅ Program updated: ${id} by ${req.admin.email}`);

    res.json({ 
      success: true, 
      message: 'Course updated successfully',
      program: {
        programId: program.programId,
        title: program.title,
        description: program.description,
        topicIds: program.topicIds
      }
    });

  } catch (error) {
    console.error('Error updating program:', error);
    res.status(500).json({ error: 'Failed to update course: ' + error.message });
  }
});

// DELETE /api/programs/:id
router.delete('/:id', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const program = await Program.findOne({ programId: id });

    if (!program) {
      return res.status(404).json({ error: 'Course not found' });
    }

    // Check permissions
    if (!program.canDelete(req.admin.email, req.admin.role)) {
      return res.status(403).json({ 
        error: 'You do not have permission to delete this course',
        message: 'Only the course creator or super admins can delete courses'
      });
    }

    // Delete from MongoDB
    await Program.deleteOne({ programId: id });

    // Free up the programId for reuse
    await freeProgramId(id);

    console.log(`🗑️ Program deleted: ${id} by ${req.admin.email}`);

    res.json({ 
      success: true, 
      message: 'Course deleted successfully' 
    });

  } catch (error) {
    console.error('Error deleting program:', error);
    res.status(500).json({ error: 'Failed to delete course: ' + error.message });
  }
});

// GET /api/programs/:id/permissions
router.get('/:id/permissions', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const userEmail = req.admin.email;
    const userRole = req.admin.role;
    
    const program = await Program.findOne({ programId: id });
    
    if (!program) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    const isSuperAdmin = userRole === 'super_admin';
    const isAuthor = program.createdBy === userEmail;
    const isCollaborator = program.collaborators.some(
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

// ============================================
// COLLABORATOR MANAGEMENT ROUTES
// ============================================

// POST /api/programs/:id/collaborators
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
    
    const program = await Program.findOne({ programId: id });
    
    if (!program) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    // Check permissions
    if (!program.canEditInfo(req.admin.email, req.admin.role)) {
      return res.status(403).json({ 
        error: 'You do not have permission to manage collaborators'
      });
    }
    
    // Check if already a collaborator
    const existingCollab = program.collaborators.find(c => c.email === collaboratorEmail);
    if (existingCollab) {
      return res.status(400).json({ 
        error: `${collaboratorEmail} is already a collaborator (status: ${existingCollab.status})` 
      });
    }
    
    // Add collaborator
    program.collaborators.push({
      email: collaboratorEmail,
      status: 'accepted', // For simplicity, auto-accept
      addedBy: req.admin.email,
      addedAt: new Date()
    });
    
    program.lastModifiedBy = req.admin.email;
    program.lastModifiedAt = new Date();
    
    await program.save();
    
    console.log(`✅ Collaborator ${collaboratorEmail} added to program ${id}`);
    
    res.json({ 
      success: true, 
      message: `Collaborator ${collaboratorEmail} added successfully`
    });
    
  } catch (error) {
    console.error('Error adding collaborator:', error);
    res.status(500).json({ error: 'Failed to add collaborator: ' + error.message });
  }
});

// DELETE /api/programs/:id/collaborators/:email
router.delete('/:id/collaborators/:email', verifyAdmin, async (req, res) => {
  try {
    const { id, email } = req.params;
    
    const program = await Program.findOne({ programId: id });
    
    if (!program) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    // Check permissions
    if (!program.canEditInfo(req.admin.email, req.admin.role)) {
      return res.status(403).json({ 
        error: 'You do not have permission to manage collaborators'
      });
    }
    
    const originalLength = program.collaborators.length;
    program.collaborators = program.collaborators.filter(c => c.email !== email);
    
    if (program.collaborators.length === originalLength) {
      return res.status(404).json({ error: 'Collaborator not found' });
    }
    
    program.lastModifiedBy = req.admin.email;
    program.lastModifiedAt = new Date();
    
    await program.save();
    
    console.log(`✅ Collaborator ${email} removed from program ${id}`);
    
    res.json({ success: true, message: 'Collaborator removed' });
    
  } catch (error) {
    console.error('Error removing collaborator:', error);
    res.status(500).json({ error: 'Failed to remove collaborator' });
  }
});

module.exports = router;