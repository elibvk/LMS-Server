require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const invitesRoutes = require('./routes/invites');
const userAuthRoutes = require('./routes/userAuth');

const app = express();

const allowedOrigins = [
  'http://localhost:5173',
  'https://resources.vijayonline.in'
];

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
// Middleware
// app.use(cors({ 
//   origin: process.env.CLIENT_URL || 'http://localhost:5173',
//   credentials: true,
//   methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
//   allowedHeaders: ['Content-Type', 'Authorization', 'Accept'] 
// }));
app.use(express.json());

// Serve uploaded docs as static files
const docsPath = path.join(__dirname, '../client/public/docs');
app.use('/docs', express.static(docsPath));

const uploadsPath = path.join(__dirname, '../uploads');
app.use('/uploads', express.static(uploadsPath));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✅ MongoDB Connected');
    // Create first super admin if none exists
    initializeSuperAdmin();
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

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Server is running',
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`📁 Serving docs from: ${docsPath}`);
  console.log(`📁 Serving uploads from: ${uploadsPath}`);
});