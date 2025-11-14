const Admin = require('../models/Admin');

// Middleware to verify if user is an admin
async function verifyAdmin(req, res, next) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'No authorization token provided' });
    }

    // In production, verify JWT token here
    // For now, token is admin email (stored in localStorage)
    const admin = await Admin.findOne({ email: token });

    if (!admin) {
      return res.status(403).json({ error: 'Not authorized as admin' });
    }

    // Attach admin to request
    req.admin = admin;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Authorization failed' });
  }
}

module.exports = { verifyAdmin };