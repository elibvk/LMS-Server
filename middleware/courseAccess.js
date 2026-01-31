const Course = require('../models/Course');
const Admin = require('../models/Admin');

// Helper: Check if user can edit course content
async function canEditContent(courseId, userEmail, userRole) {
  // Super admin can edit everything
  if (userRole === 'super_admin') {
    return { canEdit: true, isAuthor: false, isSuperAdmin: true };
  }

  const course = await Course.findOne({ projectId: courseId });
  
  if (!course) {
    return { canEdit: false, isAuthor: false, isSuperAdmin: false };
  }

  // Check if user is the author
  const isAuthor = course.createdBy === userEmail;
  if (isAuthor) {
    return { canEdit: true, isAuthor: true, isSuperAdmin: false };
  }

  // Check if user is an accepted collaborator
  const isCollaborator = course.collaborators.some(
    c => c.email === userEmail && c.status === 'accepted'
  );

  return { 
    canEdit: isCollaborator, 
    isAuthor: false, 
    isSuperAdmin: false,
    isCollaborator
  };
}

// Helper: Check if user can edit course info
async function canEditInfo(courseId, userEmail, userRole) {
  // Super admin can edit everything
  if (userRole === 'super_admin') {
    return { canEdit: true, isAuthor: false, isSuperAdmin: true };
  }

  const course = await Course.findOne({ projectId: courseId });
  
  if (!course) {
    return { canEdit: false, isAuthor: false, isSuperAdmin: false };
  }

  // Only author can edit course info (not collaborators)
  const isAuthor = course.createdBy === userEmail;
  
  return { 
    canEdit: isAuthor, 
    isAuthor, 
    isSuperAdmin: false 
  };
}

// Middleware: Check if user can edit course content
async function checkContentEditAccess(req, res, next) {
  try {
    const { id } = req.params;
    const userEmail = req.admin?.email || req.user?.email;
    const userRole = req.admin?.role;

    if (!userEmail) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { canEdit, isAuthor, isSuperAdmin, isCollaborator } = await canEditContent(id, userEmail, userRole);

    if (!canEdit) {
      return res.status(403).json({ 
        error: 'You do not have permission to edit this course content',
        message: 'Only the course author, collaborators, or super admins can edit content'
      });
    }

    // Attach permissions to request
    req.coursePermissions = {
      canEditContent: true,
      canEditInfo: isAuthor || isSuperAdmin,
      canManageCollaborators: isAuthor || isSuperAdmin,
      isAuthor,
      isSuperAdmin,
      isCollaborator
    };

    next();
  } catch (error) {
    console.error('Content access check error:', error);
    res.status(500).json({ error: 'Failed to verify permissions' });
  }
}

// Middleware: Check if user can edit course info
async function checkInfoEditAccess(req, res, next) {
  try {
    const { id } = req.params;
    const userEmail = req.admin?.email || req.user?.email;
    const userRole = req.admin?.role;

    if (!userEmail) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { canEdit, isAuthor, isSuperAdmin } = await canEditInfo(id, userEmail, userRole);

    if (!canEdit) {
      return res.status(403).json({ 
        error: 'You do not have permission to edit course information',
        message: 'Only the course author or super admins can edit course info and manage collaborators'
      });
    }

    // Attach permissions to request
    req.coursePermissions = {
      canEditContent: true,
      canEditInfo: true,
      canManageCollaborators: true,
      isAuthor,
      isSuperAdmin
    };

    next();
  } catch (error) {
    console.error('Info access check error:', error);
    res.status(500).json({ error: 'Failed to verify permissions' });
  }
}

// Helper: Check if email is registered (admin or regular user)
async function isRegisteredUser(email) {
  try {
    // Check if admin
    const admin = await Admin.findOne({ email });
    if (admin) {
      return { exists: true, isAdmin: true, user: admin };
    }

    // Check if regular user
    const User = require('../models/User');
    const user = await User.findOne({ email });
    if (user) {
      return { exists: true, isAdmin: false, user };
    }

    // Email not registered
    return { exists: false, isAdmin: false, user: null };
  } catch (error) {
    console.error('Error checking user:', error);
    return { exists: false, isAdmin: false, user: null };
  }
}

module.exports = {
  checkContentEditAccess,
  checkInfoEditAccess,
  canEditContent,
  canEditInfo,
  isRegisteredUser
};

// const path = require('path');
// const fs = require('fs').promises;
// const Admin = require('../models/Admin');

// // Helper: Load index.json
// async function loadIndexJson() {
//   const docsDir = path.join(process.cwd(), 'client/public/docs');
//   const indexPath = path.join(docsDir, 'index.json');
  
//   try {
//     const content = await fs.readFile(indexPath, 'utf-8');
//     return JSON.parse(content);
//   } catch (err) {
//     return [];
//   }
// }

// // Helper: Check if user can edit course content
// async function canEditContent(courseId, userEmail, userRole) {
//   // Super admin can edit everything
//   if (userRole === 'super_admin') {
//     return { canEdit: true, isAuthor: false, isSuperAdmin: true };
//   }

//   const courses = await loadIndexJson();
//   const course = courses.find(c => c.proj === courseId);
  
//   if (!course) {
//     return { canEdit: false, isAuthor: false, isSuperAdmin: false };
//   }

//   // Check if user is the author
//   const isAuthor = course.createdBy === userEmail;
//   if (isAuthor) {
//     return { canEdit: true, isAuthor: true, isSuperAdmin: false };
//   }

//   // Check if user is an accepted collaborator
//   const isCollaborator = course.collaborators?.some(
//     c => c.email === userEmail && c.status === 'accepted'
//   );

//   return { 
//     canEdit: isCollaborator, 
//     isAuthor: false, 
//     isSuperAdmin: false,
//     isCollaborator
//   };
// }

// // Helper: Check if user can edit course info
// async function canEditInfo(courseId, userEmail, userRole) {
//   // Super admin can edit everything
//   if (userRole === 'super_admin') {
//     return { canEdit: true, isAuthor: false, isSuperAdmin: true };
//   }

//   const courses = await loadIndexJson();
//   const course = courses.find(c => c.proj === courseId);
  
//   if (!course) {
//     return { canEdit: false, isAuthor: false, isSuperAdmin: false };
//   }

//   // Only author can edit course info (not collaborators)
//   const isAuthor = course.createdBy === userEmail;
  
//   return { 
//     canEdit: isAuthor, 
//     isAuthor, 
//     isSuperAdmin: false 
//   };
// }

// // Middleware: Check if user can edit course content
// async function checkContentEditAccess(req, res, next) {
//   try {
//     const { id } = req.params;
//     const userEmail = req.admin?.email || req.user?.email;
//     const userRole = req.admin?.role;

//     if (!userEmail) {
//       return res.status(401).json({ error: 'Authentication required' });
//     }

//     const { canEdit, isAuthor, isSuperAdmin, isCollaborator } = await canEditContent(id, userEmail, userRole);

//     if (!canEdit) {
//       return res.status(403).json({ 
//         error: 'You do not have permission to edit this course content',
//         message: 'Only the course author, collaborators, or super admins can edit content'
//       });
//     }

//     // Attach permissions to request
//     req.coursePermissions = {
//       canEditContent: true,
//       canEditInfo: isAuthor || isSuperAdmin,
//       canManageCollaborators: isAuthor || isSuperAdmin,
//       isAuthor,
//       isSuperAdmin,
//       isCollaborator
//     };

//     next();
//   } catch (error) {
//     console.error('Content access check error:', error);
//     res.status(500).json({ error: 'Failed to verify permissions' });
//   }
// }

// // Middleware: Check if user can edit course info
// async function checkInfoEditAccess(req, res, next) {
//   try {
//     const { id } = req.params;
//     const userEmail = req.admin?.email || req.user?.email;
//     const userRole = req.admin?.role;

//     if (!userEmail) {
//       return res.status(401).json({ error: 'Authentication required' });
//     }

//     const { canEdit, isAuthor, isSuperAdmin } = await canEditInfo(id, userEmail, userRole);

//     if (!canEdit) {
//       return res.status(403).json({ 
//         error: 'You do not have permission to edit course information',
//         message: 'Only the course author or super admins can edit course info and manage collaborators'
//       });
//     }

//     // Attach permissions to request
//     req.coursePermissions = {
//       canEditContent: true,
//       canEditInfo: true,
//       canManageCollaborators: true,
//       isAuthor,
//       isSuperAdmin
//     };

//     next();
//   } catch (error) {
//     console.error('Info access check error:', error);
//     res.status(500).json({ error: 'Failed to verify permissions' });
//   }
// }

// // Helper: Check if email is registered (admin or regular user)
// async function isRegisteredUser(email) {
//   try {
//     // Check if admin
//     const admin = await Admin.findOne({ email });
//     if (admin) {
//       return { exists: true, isAdmin: true, user: admin };
//     }

//     // Check if regular user
//     const User = require('../models/User');
//     const user = await User.findOne({ email });
//     if (user) {
//       return { exists: true, isAdmin: false, user };
//     }

//     // Email not registered
//     return { exists: false, isAdmin: false, user: null };
//   } catch (error) {
//     console.error('Error checking user:', error);
//     return { exists: false, isAdmin: false, user: null };
//   }
// }

// module.exports = {
//   checkContentEditAccess,
//   checkInfoEditAccess,
//   canEditContent,
//   canEditInfo,
//   isRegisteredUser,
//   loadIndexJson
// };