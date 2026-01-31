// server/server.js - CLEANED VERSION
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const invitesRoutes = require('./routes/invites');
const userAuthRoutes = require('./routes/userAuth');
const programsRouter = require('./routes/programs');
const modulesRouter = require('./routes/modules');
const quizRouter = require('./routes/quiz');

const app = express();

app.use(cors({
  origin: [
    "https://resources.vijayonline.in",
    "https://www.resources.vijayonline.in",
    "https://elib.in",
    "https://www.elib.in",
    "http://localhost:5173"
  ],
  credentials: true
}));

app.use(express.json());

// Serve uploaded docs as static files
const docsPath = path.join(__dirname, '../client/public/docs');
console.log("STATIC DOCS PATH:", docsPath);
app.use('/docs', express.static(docsPath));

const uploadsPath = path.join(__dirname, '../uploads');
app.use('/uploads', express.static(uploadsPath));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✅ MongoDB Connected');
    // Create first super admin if none exists
    initializeSuperAdmin();
    
    // ✅ CLEANUP SERVICE REMOVED - No auto-expiry in new system
  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });

// Initialize first super admin
async function initializeSuperAdmin() {
  const Admin = require('./models/Admin');
  const count = await Admin.countDocuments();
  
  if (count === 0) {
    await Admin.create({
      email: 'eisoftech.in@gmail.com',
      name: 'Super Admin',
      role: 'super_admin'
    });
    console.log('✅ Super admin created: eisoftech.in@gmail.com');
  }
}

// Routes
app.use('/api/auth', require('./routes/auth.js'));
app.use('/api/courses', require('./routes/courses.js'));
app.use('/api/admins', require('./routes/admins.js'));
app.use('/api/invites', invitesRoutes);
app.use('/api/user-auth', userAuthRoutes);
app.use('/api/programs', programsRouter);
app.use('/api/modules', modulesRouter);
app.use('/api/quiz', quizRouter);

app.get('/', (req, res) => {
  res.send("Welcome to E-Lib API Service");
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Server is running',
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`📁 Serving docs from: ${docsPath}`);
  console.log(`📁 Serving uploads from: ${uploadsPath}`);
});

// ✅ GRACEFUL SHUTDOWN HANDLERS REMOVED
// No cleanup service to stop in new system// require('dotenv').config();
// const express = require('express');
// const cors = require('cors');
// const mongoose = require('mongoose');
// const path = require('path');
// const invitesRoutes = require('./routes/invites');
// const userAuthRoutes = require('./routes/userAuth');
// const programsRouter = require('./routes/programs');
// const modulesRouter = require('./routes/modules');
// const quizRouter = require('./routes/quiz');

// const app = express();

// // const allowedOrigins = [
// //   'http://localhost:5173',
// //   'https://resources.vijayonline.in'
// // ];

// app.use(cors({
//   origin: [
//     "https://resources.vijayonline.in",
//     "https://www.resources.vijayonline.in",
//     "https://elib.in",
//     "https://www.elib.in",
//     "http://localhost:5173"
//   ],
//   credentials: true
// }));


// app.use(express.json());

// // Serve uploaded docs as static files
// const docsPath = path.join(__dirname, 'client/public/docs');
// console.log("STATIC DOCS PATH:", docsPath);
// app.use('/docs', express.static(docsPath));

// const uploadsPath = path.join(__dirname, '../uploads');
// app.use('/uploads', express.static(uploadsPath));

// // const cleanupService = require('./services/quizCleanup');

// // MongoDB Connection
// mongoose.connect(process.env.MONGODB_URI)
//   .then(() => {
//     console.log('✅ MongoDB Connected');
//     // Create first super admin if none exists
//     initializeSuperAdmin();

//     // Start quiz cleanup service
//     ///cleanupService.start(30000); // Run every 30 seconds
//   })
//   .catch(err => {
//     console.error('❌ MongoDB connection error:', err);
//     process.exit(1);
//   });

// // Initialize first super admin
// async function initializeSuperAdmin() {
//   const Admin = require('./models/Admin');
//   const count = await Admin.countDocuments();
  
//   if (count === 0) {
//     await Admin.create({
//       email: 'eisoftech.in@gmail.com',
//       name: 'Super Admin',
//       role: 'super_admin'
//     });
//     console.log('✅ Super admin created: eisoftech.in@gmail.com');
//   }
// }

// // Routes
// app.use('/api/auth', require('./routes/auth.js'));
// app.use('/api/courses', require('./routes/courses.js'));
// app.use('/api/admins', require('./routes/admins.js'));
// app.use('/api/invites', invitesRoutes);
// app.use('/api/user-auth', userAuthRoutes);
// app.use('/api/programs', programsRouter);
// app.use('/api/modules', modulesRouter);
// app.use('/api/quiz', quizRouter);

// app.get('/',(req,res)=>{
//   res.send("Welcome to E-Lib API Service");
// });
// // Health check
// app.get('/health', (req, res) => {
//   res.json({ 
//     status: 'ok', 
//     message: 'Server is running',
//     mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
//   });
// });

// const PORT = process.env.PORT || 5000;
// app.listen(PORT,"0.0.0.0", () => {
//   console.log(`✅ Server running on http://localhost:${PORT}`);
//   console.log(`📁 Serving docs from: ${docsPath}`);
//   console.log(`📁 Serving uploads from: ${uploadsPath}`);
// });