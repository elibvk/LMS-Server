const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const invitesRoutes = require('./routes/invites');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors({ 
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true 
}));
app.use(express.json());

// Serve uploaded docs as static files
const docsPath = path.join(__dirname, '../client/public/docs');
app.use('/docs', express.static(docsPath));

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
});