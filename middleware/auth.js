// server/middleware/auth.js

const Admin = require('../models/Admin');
const User = require('../models/User');
const jwt = require('jsonwebtoken');

// Existing verifyAdmin middleware (keep as is)
async function verifyAdmin(req, res, next) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const admin = await Admin.findOne({ email: token });
    
    if (!admin) {
      return res.status(403).json({ error: 'Invalid token' });
    }

    req.admin = {
      id: admin._id,
      email: admin.email,
      name: admin.name,
      role: admin.role
    };
    
    next();
  } catch (error) {
    console.error('Error verifying admin:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
}

// 🆕 NEW: Verify User (Regular User Authentication)
async function verifyUser(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Find user
    const user = await User.findById(decoded.userId);
    
    if (!user) {
      return res.status(403).json({ error: 'User not found' });
    }

    req.user = {
      id: user._id,
      email: user.email,
      name: user.name
    };
    
    next();
  } catch (error) {
    console.error('Error verifying user:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(403).json({ error: 'Invalid token' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(403).json({ error: 'Token expired' });
    }
    
    res.status(500).json({ error: 'Authentication failed' });
  }
}

// 🆕 NEW: Verify Either Admin OR User (for quiz generation)
async function verifyAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'Authentication required',
        message: 'Please login to generate quizzes'
      });
    }

    const token = authHeader.split(' ')[1];

    // Try Admin first (email-based token)
    const admin = await Admin.findOne({ email: token });
    
    if (admin) {
      req.user = {
        id: admin._id,
        email: admin.email,
        name: admin.name,
        role: 'admin',
        isAdmin: true
      };
      return next();
    }

    // Try User (JWT token)
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.userId);
      
      if (user) {
        req.user = {
          id: user._id,
          email: user.email,
          name: user.name,
          role: 'user',
          isAdmin: false
        };
        return next();
      }
    } catch (jwtError) {
      // JWT verification failed, continue to error below
    }

    // Neither admin nor user token valid
    return res.status(403).json({ 
      error: 'Invalid authentication',
      message: 'Please login again'
    });

  } catch (error) {
    console.error('Error in verifyAuth:', error);
    res.status(500).json({ 
      error: 'Authentication failed',
      message: 'Please try again'
    });
  }
}

module.exports = { 
  verifyAdmin, 
  verifyUser,
  verifyAuth  // 🆕 Export new middleware
};