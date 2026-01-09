// server/routes/modules.js
const express = require('express');
const { verifyAdmin } = require('../middleware/auth');
const Module = require('../models/Module');
const ModuleId = require('../models/ModuleId');
const Program = require('../models/Programs');
const Course = require('../models/Course');
const router = express.Router();

// ============================================
// HELPER FUNCTIONS
// ============================================

// Helper: pad number to 4 digits
function padId(num) {
  return String(num).padStart(4, '0');
}

// Assign next available module ID (M0001, M0002, etc.)
async function assignNextAvailableModuleId() {
  const doc = await ModuleId.findOne() || new ModuleId();
  const usedSet = new Set(doc.used || []);

  let candidate = 1;
  while (true) {
    const mid = 'M' + padId(candidate);
    if (!usedSet.has(mid)) {
      doc.used.push(mid);
      await doc.save();
      return mid;
    }
    candidate += 1;
    if (candidate > 9999) throw new Error('No available module IDs');
  }
}

// Free (make reusable) a moduleId
async function freeModuleId(moduleId) {
  const doc = await ModuleId.findOne();
  if (!doc) return;
  const idx = (doc.used || []).indexOf(moduleId);
  if (idx !== -1) {
    doc.used.splice(idx, 1);
    await doc.save();
  }
}

// ============================================
// MODULE CRUD ROUTES
// ============================================

// POST /api/modules/create
router.post('/create', verifyAdmin, async (req, res) => {
  try {
    const { programId, title, description, order, topicIds } = req.body;

    if (!programId) {
      return res.status(400).json({ error: 'Program ID is required' });
    }

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Module title is required' });
    }

    // Validate program exists
    const program = await Program.findOne({ programId });
    if (!program) {
      return res.status(404).json({ error: 'Program not found' });
    }

    // Check permissions
    if (!program.canEditContent(req.admin.email, req.admin.role)) {
      return res.status(403).json({ 
        error: 'You do not have permission to edit this program' 
      });
    }

    // Assign module ID
    const moduleId = await assignNextAvailableModuleId();

    // Determine order (if not provided, put at end)
    let moduleOrder = order;
    if (moduleOrder === undefined || moduleOrder === null) {
      const existingModules = await Module.find({ programId }).sort({ order: -1 }).limit(1);
      moduleOrder = existingModules.length > 0 ? existingModules[0].order + 1 : 0;
    }

    // Create module
    const module = new Module({
      moduleId,
      programId,
      title: title.trim(),
      description: description ? description.trim() : '',
      order: moduleOrder,
      topicIds: topicIds || [],
      createdBy: req.admin.email,
      lastModifiedBy: req.admin.email
    });

    await module.save();

    // Update program's modules array
    if (!program.modules) {
      program.modules = [];
    }
    program.modules.push({ moduleId, order: moduleOrder });
    program.modules.sort((a, b) => a.order - b.order);
    program.lastModifiedBy = req.admin.email;
    program.lastModifiedAt = new Date();
    await program.save();

    console.log(`✅ Module created: ${moduleId} for program ${programId} by ${req.admin.email}`);

    res.json({
      success: true,
      message: 'Module created successfully',
      module: {
        moduleId: module.moduleId,
        programId: module.programId,
        title: module.title,
        description: module.description,
        order: module.order,
        topicIds: module.topicIds
      }
    });

  } catch (error) {
    console.error('Error creating module:', error);
    res.status(500).json({ error: 'Failed to create module: ' + error.message });
  }
});

// GET /api/modules/program/:programId - Get all modules for a program
router.get('/program/:programId', async (req, res) => {
  try {
    const { programId } = req.params;

    // Check if program exists
    const program = await Program.findOne({ programId });
    if (!program) {
      return res.status(404).json({ error: 'Program not found' });
    }

    // Get all modules for this program
    const modules = await Module.find({ programId }).sort({ order: 1 });

    // For each module, fetch the full topic details
    const modulesWithTopics = await Promise.all(
      modules.map(async (module) => {
        const topics = await Course.find({ 
          projectId: { $in: module.topicIds } 
        });
        
        return {
          moduleId: module.moduleId,
          title: module.title,
          description: module.description,
          order: module.order,
          topicIds: module.topicIds,
          topics,
          createdBy: module.createdBy,
          createdAt: module.createdAt
        };
      })
    );

    res.json({
      success: true,
      modules: modulesWithTopics
    });

  } catch (error) {
    console.error('Error fetching modules:', error);
    res.status(500).json({ error: 'Failed to fetch modules' });
  }
});

// GET /api/modules/:moduleId - Get single module
router.get('/:moduleId', async (req, res) => {
  try {
    const { moduleId } = req.params;

    const module = await Module.findOne({ moduleId });
    if (!module) {
      return res.status(404).json({ error: 'Module not found' });
    }

    // Fetch topics
    const topics = await Course.find({ 
      projectId: { $in: module.topicIds } 
    });

    res.json({
      success: true,
      module: {
        ...module.toObject(),
        topics
      }
    });

  } catch (error) {
    console.error('Error fetching module:', error);
    res.status(500).json({ error: 'Failed to fetch module' });
  }
});

// PUT /api/modules/:moduleId - Update module
router.put('/:moduleId', verifyAdmin, async (req, res) => {
  try {
    const { moduleId } = req.params;
    const { title, description, topicIds, order } = req.body;

    const module = await Module.findOne({ moduleId });
    if (!module) {
      return res.status(404).json({ error: 'Module not found' });
    }

    // Check permissions via program
    const program = await Program.findOne({ programId: module.programId });
    if (!program.canEditContent(req.admin.email, req.admin.role)) {
      return res.status(403).json({ 
        error: 'You do not have permission to edit this module' 
      });
    }

    // Update fields
    if (title !== undefined) module.title = title.trim();
    if (description !== undefined) module.description = description.trim();
    if (topicIds !== undefined) module.topicIds = topicIds;
    if (order !== undefined) module.order = order;

    module.lastModifiedBy = req.admin.email;
    module.lastModifiedAt = new Date();

    await module.save();

    console.log(`✅ Module updated: ${moduleId} by ${req.admin.email}`);

    res.json({ 
      success: true, 
      message: 'Module updated successfully',
      module: {
        moduleId: module.moduleId,
        title: module.title,
        description: module.description,
        order: module.order,
        topicIds: module.topicIds
      }
    });

  } catch (error) {
    console.error('Error updating module:', error);
    res.status(500).json({ error: 'Failed to update module: ' + error.message });
  }
});

// DELETE /api/modules/:moduleId
router.delete('/:moduleId', verifyAdmin, async (req, res) => {
  try {
    const { moduleId } = req.params;

    const module = await Module.findOne({ moduleId });
    if (!module) {
      return res.status(404).json({ error: 'Module not found' });
    }

    // Check permissions
    const program = await Program.findOne({ programId: module.programId });
    if (!program.canEditContent(req.admin.email, req.admin.role)) {
      return res.status(403).json({ 
        error: 'You do not have permission to delete this module' 
      });
    }

    // Remove from program's modules array
    program.modules = program.modules.filter(m => m.moduleId !== moduleId);
    program.lastModifiedBy = req.admin.email;
    program.lastModifiedAt = new Date();
    await program.save();

    // Delete module
    await Module.deleteOne({ moduleId });

    // Free up the moduleId for reuse
    await freeModuleId(moduleId);

    console.log(`🗑️ Module deleted: ${moduleId} by ${req.admin.email}`);

    res.json({ 
      success: true, 
      message: 'Module deleted successfully' 
    });

  } catch (error) {
    console.error('Error deleting module:', error);
    res.status(500).json({ error: 'Failed to delete module: ' + error.message });
  }
});

// POST /api/modules/reorder - Reorder modules in a program
router.post('/reorder', verifyAdmin, async (req, res) => {
  try {
    const { programId, moduleOrders } = req.body;
    // moduleOrders: [{ moduleId: 'M0001', order: 0 }, { moduleId: 'M0002', order: 1 }, ...]

    if (!programId || !Array.isArray(moduleOrders)) {
      return res.status(400).json({ 
        error: 'programId and moduleOrders array are required' 
      });
    }

    const program = await Program.findOne({ programId });
    if (!program) {
      return res.status(404).json({ error: 'Program not found' });
    }

    // Check permissions
    if (!program.canEditContent(req.admin.email, req.admin.role)) {
      return res.status(403).json({ 
        error: 'You do not have permission to reorder modules' 
      });
    }

    // Update each module's order
    for (const { moduleId, order } of moduleOrders) {
      await Module.updateOne({ moduleId }, { order });
    }

    // Update program's modules array
    program.modules = moduleOrders.map(mo => ({ 
      moduleId: mo.moduleId, 
      order: mo.order 
    }));
    program.modules.sort((a, b) => a.order - b.order);
    program.lastModifiedBy = req.admin.email;
    program.lastModifiedAt = new Date();
    await program.save();

    console.log(`✅ Modules reordered for program ${programId}`);

    res.json({ 
      success: true, 
      message: 'Modules reordered successfully' 
    });

  } catch (error) {
    console.error('Error reordering modules:', error);
    res.status(500).json({ error: 'Failed to reorder modules: ' + error.message });
  }
});

module.exports = router;