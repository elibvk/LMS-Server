// server/models/Course.js
const mongoose = require('mongoose');

const collaboratorSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, trim: true },
  status: { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending' },
  addedBy: { type: String, required: true },
  addedAt: { type: Date, default: Date.now },
  acceptedAt: { type: Date, default: null },
  inviteToken: { type: String, default: null }
}, { _id: false });

const courseSchema = new mongoose.Schema({
  projectId: { type: String, required: true, unique: true, trim: true, index: true }, // "0001"
  slug: { type: String, required: true }, // fixed slug created at course creation
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '', trim: true },
  keywords: [{ type: String, trim: true }],

  // Tracking
  createdBy: { type: String, required: true, trim: true },
  createdAt: { type: Date, default: Date.now },
  lastModifiedBy: { type: String, required: true, trim: true },
  lastModifiedAt: { type: Date, default: Date.now },

  // Collaborators
  collaborators: [collaboratorSchema],

  // File system sync status (optional)
  filesSynced: { type: Boolean, default: false },
  lastSyncedAt: { type: Date, default: null }
}, {
  timestamps: true
});

// Indexes
courseSchema.index({ title: 'text', description: 'text' });
courseSchema.index({ createdBy: 1 });
courseSchema.index({ 'collaborators.email': 1 });

// Permission helpers
courseSchema.methods.canEditContent = function(userEmail, userRole) {
  if (userRole === 'super_admin') return true;
  if (this.createdBy === userEmail) return true;
  return this.collaborators.some(c => c.email === userEmail && c.status === 'accepted');
};

courseSchema.methods.canEditInfo = function(userEmail, userRole) {
  if (userRole === 'super_admin') return true;
  if (this.createdBy === userEmail) return true;
  return false;
};

// Static helper to find courses a user can access
courseSchema.statics.findAccessibleByUser = function(userEmail, userRole) {
  if (userRole === 'super_admin') return this.find({});
  return this.find({
    $or: [
      { createdBy: userEmail },
      { 'collaborators.email': userEmail, 'collaborators.status': 'accepted' }
    ]
  });
};

module.exports = mongoose.model('Course', courseSchema);

// const mongoose = require('mongoose');

// const collaboratorSchema = new mongoose.Schema({
//   email: {
//     type: String,
//     required: true,
//     lowercase: true,
//     trim: true
//   },
//   status: {
//     type: String,
//     enum: ['pending', 'accepted', 'declined'],
//     default: 'pending'
//   },
//   addedBy: {
//     type: String,
//     required: true
//   },
//   addedAt: {
//     type: Date,
//     default: Date.now
//   },
//   acceptedAt: {
//     type: Date,
//     default: null
//   },
//   inviteToken: {
//     type: String,
//     default: null
//   }
// }, { _id: false });

// const courseSchema = new mongoose.Schema({
//   projectId: {
//     type: String,
//     required: true,
//     unique: true,
//     trim: true,
//     index: true
//   },
//   slug: {
//     type: String,
//     required: true,
//   },
//   title: {
//     type: String,
//     required: true,
//     trim: true
//   },
//   description: {
//     type: String,
//     default: '',
//     trim: true
//   },
//   keywords: [{
//     type: String,
//     trim: true
//   }],
  
//   // Content stored in MongoDB
//   readmeContent: {
//     type: String,
//     default: ''
//   },
//   sidebarContent: {
//     type: String,
//     default: ''
//   },
//   indexHtmlContent: {
//     type: String,
//     default: ''
//   },
  
//   // Tracking
//   createdBy: {
//     type: String,
//     required: true,
//     trim: true
//   },
//   createdAt: {
//     type: Date,
//     default: Date.now
//   },
//   lastModifiedBy: {
//     type: String,
//     required: true,
//     trim: true
//   },
//   lastModifiedAt: {
//     type: Date,
//     default: Date.now
//   },
  
//   // Collaborators
//   collaborators: [collaboratorSchema],
  
//   // File system sync status
//   filesSynced: {
//     type: Boolean,
//     default: false
//   },
//   lastSyncedAt: {
//     type: Date,
//     default: null
//   }
// }, {
//   timestamps: true
// });

// // Index for faster searches
// courseSchema.index({ title: 'text', description: 'text' });
// courseSchema.index({ createdBy: 1 });
// courseSchema.index({ 'collaborators.email': 1 });

// // Method to check if user can edit content
// courseSchema.methods.canEditContent = function(userEmail, userRole) {
//   if (userRole === 'super_admin') return true;
//   if (this.createdBy === userEmail) return true;
  
//   const isCollaborator = this.collaborators.some(
//     c => c.email === userEmail && c.status === 'accepted'
//   );
  
//   return isCollaborator;
// };

// // Method to check if user can edit info
// courseSchema.methods.canEditInfo = function(userEmail, userRole) {
//   if (userRole === 'super_admin') return true;
//   if (this.createdBy === userEmail) return true;
//   return false;
// };

// // Method to generate sidebar from README
// courseSchema.methods.generateSidebar = function() {
//   const lines = this.readmeContent.split('\n');
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

//   this.sidebarContent = headers.length > 0 
//     ? headers.join('\n') 
//     : '* [Home](README.md)';
  
//   return this.sidebarContent;
// };

// // Method to generate index.html
// courseSchema.methods.generateIndexHtml = function() {
//   this.indexHtmlContent = `<!DOCTYPE html>
// <html>
// <head>
//   <meta charset="UTF-8">
//   <title>${this.title}</title>
//   <meta name="viewport" content="width=device-width, initial-scale=1">
//   <link rel="stylesheet" href="//cdn.jsdelivr.net/npm/docsify@4/lib/themes/vue.css">
// </head>
// <body>
//   <div id="app">Loading...</div>

//   <script>
//     window.$docsify = {
//       name: '${this.title}',
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
  
//   return this.indexHtmlContent;
// };

// // Static method to find courses user can access
// courseSchema.statics.findAccessibleByUser = function(userEmail, userRole) {
//   if (userRole === 'super_admin') {
//     return this.find({});
//   }
  
//   return this.find({
//     $or: [
//       { createdBy: userEmail },
//       { 'collaborators.email': userEmail, 'collaborators.status': 'accepted' }
//     ]
//   });
// };

// const Course = mongoose.model('Course', courseSchema);

// module.exports = Course;