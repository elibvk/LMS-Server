const express = require('express');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const Admin = require('../models/Admin');

const router = express.Router();

// In-memory storage for OTPs (in production, use Redis)
const otpStore = new Map();

// Email transporter setup
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// POST /api/auth/send-magic-link
// Sends magic link to any registered admin email
router.post('/send-magic-link', async (req, res) => {
  try {
    const { email } = req.body;

    // Check if email is a registered admin
    const admin = await Admin.findOne({ email });
    if (!admin) {
      return res.status(403).json({ error: 'This email is not registered as an admin' });
    }

    // Generate 6-digit OTP
    const otp = crypto.randomInt(100000, 999999).toString();
    
    // Store OTP with 10-minute expiry
    otpStore.set(email, {
      otp,
      expiresAt: Date.now() + 10 * 60 * 1000
    });

    // Create magic link
    const magicLink = `${process.env.CLIENT_URL}/admin?otp=${otp}&email=${encodeURIComponent(email)}`;

    // Send email
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Admin Login - LearnHub LMS',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #646cff;">LearnHub Admin Login</h2>
          <p>Hello ${admin.name},</p>
          <p>Click the button below to log in to your admin dashboard:</p>
          <a href="${magicLink}" 
             style="display: inline-block; padding: 12px 24px; background: #646cff; color: white; text-decoration: none; border-radius: 8px; margin: 20px 0;">
            Login to Admin Dashboard
          </a>
          <p style="color: #666; font-size: 14px;">Or use this code: <strong style="font-size: 18px; color: #333;">${otp}</strong></p>
          <p style="color: #666; font-size: 12px;">This link expires in 10 minutes.</p>
          <p style="color: #666; font-size: 12px;">If you didn't request this, please ignore this email.</p>
        </div>
      `
    });

    console.log(`✅ Magic link sent to ${email}`);
    res.json({ success: true, message: 'Magic link sent to your email' });

  } catch (error) {
    console.error('Error sending magic link:', error);
    res.status(500).json({ error: 'Failed to send magic link' });
  }
});

// POST /api/auth/verify-otp
// Verifies OTP and returns admin data
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    // Verify admin exists
    const admin = await Admin.findOne({ email });
    if (!admin) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const stored = otpStore.get(email);

    if (!stored) {
      return res.status(400).json({ error: 'No OTP found. Please request a new one.' });
    }

    if (Date.now() > stored.expiresAt) {
      otpStore.delete(email);
      return res.status(400).json({ error: 'OTP expired. Please request a new one.' });
    }

    if (stored.otp !== otp) {
      return res.status(400).json({ error: 'Invalid OTP' });
    }

    // OTP is valid - delete it
    otpStore.delete(email);

    // Update last login
    admin.lastLogin = new Date();
    await admin.save();

    console.log(`✅ Admin authenticated: ${email}`);
    
    res.json({
      success: true,
      token: email, // In production, use JWT
      admin: {
        id: admin._id,
        email: admin.email,
        name: admin.name,
        role: admin.role
      }
    });

  } catch (error) {
    console.error('Error verifying OTP:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// GET /api/auth/verify-token
// Verify if token/email is still valid admin
router.get('/verify-token', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const admin = await Admin.findOne({ email: token });
    
    if (!admin) {
      return res.status(403).json({ error: 'Invalid token' });
    }

    res.json({
      success: true,
      admin: {
        id: admin._id,
        email: admin.email,
        name: admin.name,
        role: admin.role
      }
    });

  } catch (error) {
    console.error('Error verifying token:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

module.exports = router;