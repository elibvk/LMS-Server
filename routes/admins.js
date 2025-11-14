const express = require('express');
const Admin = require('../models/Admin');
const { verifyAdmin } = require('../middleware/auth');

const router = express.Router();

// All routes require admin authentication
router.use(verifyAdmin);

// GET /api/admins
// Get all admins (only super_admin can see all)
router.get('/', async (req, res) => {
  try {
    const admins = await Admin.find()
      .select('-__v')
      .sort({ createdAt: -1 });

    res.json({ admins });
  } catch (error) {
    console.error('Error fetching admins:', error);
    res.status(500).json({ error: 'Failed to fetch admins' });
  }
});

// POST /api/admins
// Add a new admin (only super_admin can add admins)
router.post('/', async (req, res) => {
  try {
    const { email, name, role } = req.body;

    // Only super_admin can create admins
    if (req.admin.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only super admins can add new admins' });
    }

    // Check if admin already exists
    const existing = await Admin.findOne({ email });
    if (existing) {
      return res.status(400).json({ error: 'Admin with this email already exists' });
    }

    // Create new admin
    const newAdmin = await Admin.create({
      email: email.toLowerCase().trim(),
      name: name.trim(),
      role: role || 'admin',
      createdBy: req.admin._id
    });

    console.log(`✅ New admin created: ${email} by ${req.admin.email}`);

    res.json({
      success: true,
      message: 'Admin added successfully',
      admin: {
        id: newAdmin._id,
        email: newAdmin.email,
        name: newAdmin.name,
        role: newAdmin.role
      }
    });

  } catch (error) {
    console.error('Error creating admin:', error);
    res.status(500).json({ error: 'Failed to create admin' });
  }
});

// DELETE /api/admins/:id
// Remove an admin (only super_admin)
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Only super_admin can delete admins
    if (req.admin.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only super admins can remove admins' });
    }

    // Can't delete yourself
    if (req.admin._id.toString() === id) {
      return res.status(400).json({ error: 'Cannot delete your own admin account' });
    }

    const admin = await Admin.findByIdAndDelete(id);

    if (!admin) {
      return res.status(404).json({ error: 'Admin not found' });
    }

    console.log(`✅ Admin removed: ${admin.email} by ${req.admin.email}`);

    res.json({
      success: true,
      message: 'Admin removed successfully'
    });

  } catch (error) {
    console.error('Error deleting admin:', error);
    res.status(500).json({ error: 'Failed to delete admin' });
  }
});

module.exports = router;