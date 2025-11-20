const Admin = require('../models/Admin');
const User = require('../models/User');
const { verifyAccessToken } = require('../utils/token');

// Middleware to verify if user is an admin (existing functionality)
async function verifyAdmin(req, res, next) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'No authorization token provided' });
    }

    // For backward compatibility, first check if token is an email (old system)
    let admin = await Admin.findOne({ email: token });

    // If not found, try JWT verification
    if (!admin) {
      try {
        const decoded = verifyAccessToken(token);
        
        // Check if it's an admin (user with admin/super_admin role)
        if (decoded.role === 'admin' || decoded.role === 'super_admin') {
          admin = await Admin.findOne({ email: decoded.email });
        }
        
        // If still not found, check User model for admin role
        if (!admin) {
          const user = await User.findById(decoded.id);
          if (user && (user.role === 'admin' || user.role === 'super_admin')) {
            // User is an admin, attach to request
            req.admin = {
              _id: user._id,
              email: user.email,
              name: user.name,
              role: user.role
            };
            return next();
          }
        }
      } catch (jwtError) {
        // Token verification failed
        return res.status(403).json({ error: 'Invalid or expired token' });
      }
    }

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

// Middleware to verify authenticated user (admin or regular user)
async function verifyUser(req, res, next) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'No authorization token provided' });
    }

    // Try JWT verification
    try {
      const decoded = verifyAccessToken(token);
      
      // Find user (could be in User or Admin collection)
      let user = await User.findById(decoded.id);
      
      if (!user) {
        // Check Admin collection
        const admin = await Admin.findOne({ email: decoded.email });
        if (admin) {
          user = {
            _id: admin._id,
            email: admin.email,
            name: admin.name,
            role: admin.role,
            isVerified: true
          };
        }
      }

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Attach user to request
      req.user = user;
      req.userId = user._id || user.id;
      next();
    } catch (jwtError) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }

  } catch (error) {
    console.error('User auth middleware error:', error);
    res.status(500).json({ error: 'Authorization failed' });
  }
}

// Middleware to verify user and require email verification
async function verifyVerifiedUser(req, res, next) {
  try {
    // First verify user exists
    await verifyUser(req, res, () => {});

    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Check if user is verified (admins are auto-verified)
    if (!req.user.isVerified && req.user.role === 'user') {
      return res.status(403).json({ 
        error: 'Email verification required',
        message: 'Please verify your email address to access this feature'
      });
    }

    next();
  } catch (error) {
    console.error('Verified user middleware error:', error);
    res.status(500).json({ error: 'Authorization failed' });
  }
}

// Middleware to check if user is admin or super admin
function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  next();
}

// Middleware to check if user is super admin
function requireSuperAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Super admin access required' });
  }

  next();
}

module.exports = {
  verifyAdmin,
  verifyUser,
  verifyVerifiedUser,
  requireAdmin,
  requireSuperAdmin
};