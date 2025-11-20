const express = require('express');
const User = require('../models/User');
const { generateTokenPair, verifyAccessToken } = require('../utils/token');
const { sendEmail } = require('../utils/email');

const router = express.Router();

// POST /api/user-auth/register
// Register a new user
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Validation
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Create user
    const user = new User({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password,
      role: 'user'
    });

    // Generate verification token
    const verificationToken = user.generateVerificationToken();
    await user.save();

    // Send verification email
    const verificationLink = `${process.env.CLIENT_URL}/verify-email?token=${verificationToken}`;
    
    await sendEmail({
      to: user.email,
      subject: 'Verify Your Email - LearnHub',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #667eea;">Welcome to LearnHub! 🎓</h2>
          <p>Hi ${user.name},</p>
          <p>Thank you for signing up! Please verify your email address to get started.</p>
          <a href="${verificationLink}" 
             style="display: inline-block; padding: 12px 24px; background: #667eea; color: white; text-decoration: none; border-radius: 8px; margin: 20px 0;">
            Verify Email Address
          </a>
          <p style="color: #666; font-size: 14px;">Or copy this link:</p>
          <p style="color: #666; font-size: 12px; word-break: break-all;">${verificationLink}</p>
          <p style="color: #666; font-size: 12px;">This link expires in 24 hours.</p>
          <p style="color: #666; font-size: 12px;">If you didn't create this account, please ignore this email.</p>
        </div>
      `
    });

    // Generate tokens (user can login but will see "verify email" banner)
    const tokens = generateTokenPair(user);

    console.log(`✅ User registered: ${user.email}`);

    res.status(201).json({
      success: true,
      message: 'Registration successful! Please check your email to verify your account.',
      user: user.toPublicJSON(),
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed: ' + error.message });
  }
});

// POST /api/user-auth/login
// Login user
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user and verify password
    const user = await User.findByCredentials(email, password);

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate tokens
    const tokens = generateTokenPair(user);

    console.log(`✅ User logged in: ${user.email}`);

    res.json({
      success: true,
      message: 'Login successful',
      user: user.toPublicJSON(),
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(401).json({ error: error.message || 'Login failed' });
  }
});

// GET /api/user-auth/verify-email/:token
// Verify email address
router.get('/verify-email/:token', async (req, res) => {
  try {
    const { token } = req.params;

    // Find user with valid token
    const user = await User.findOne({
      verificationToken: token,
      verificationTokenExpires: { $gt: Date.now() }
    }).select('+verificationToken +verificationTokenExpires');

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired verification token' });
    }

    // Verify user
    user.isVerified = true;
    user.verificationToken = undefined;
    user.verificationTokenExpires = undefined;
    await user.save();

    console.log(`✅ Email verified: ${user.email}`);

    res.json({
      success: true,
      message: 'Email verified successfully! You can now access all features.'
    });

  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({ error: 'Email verification failed' });
  }
});

// POST /api/user-auth/resend-verification
// Resend verification email
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.isVerified) {
      return res.status(400).json({ error: 'Email already verified' });
    }

    // Generate new token
    const verificationToken = user.generateVerificationToken();
    await user.save();

    // Send email
    const verificationLink = `${process.env.CLIENT_URL}/verify-email?token=${verificationToken}`;
    
    await sendEmail({
      to: user.email,
      subject: 'Verify Your Email - LearnHub',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #667eea;">Email Verification</h2>
          <p>Hi ${user.name},</p>
          <p>Here's your new verification link:</p>
          <a href="${verificationLink}" 
             style="display: inline-block; padding: 12px 24px; background: #667eea; color: white; text-decoration: none; border-radius: 8px; margin: 20px 0;">
            Verify Email Address
          </a>
          <p style="color: #666; font-size: 12px;">This link expires in 24 hours.</p>
        </div>
      `
    });

    res.json({
      success: true,
      message: 'Verification email sent! Please check your inbox.'
    });

  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({ error: 'Failed to resend verification email' });
  }
});

// POST /api/user-auth/forgot-password
// Request password reset
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    // Don't reveal if user exists (security)
    if (!user) {
      return res.json({
        success: true,
        message: 'If an account exists with this email, a password reset link has been sent.'
      });
    }

    // Generate reset token
    const resetToken = user.generateResetToken();
    await user.save();

    // Send reset email
    const resetLink = `${process.env.CLIENT_URL}/reset-password?token=${resetToken}`;
    
    await sendEmail({
      to: user.email,
      subject: 'Reset Your Password - LearnHub',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #667eea;">Password Reset Request</h2>
          <p>Hi ${user.name},</p>
          <p>You requested to reset your password. Click the button below:</p>
          <a href="${resetLink}" 
             style="display: inline-block; padding: 12px 24px; background: #667eea; color: white; text-decoration: none; border-radius: 8px; margin: 20px 0;">
            Reset Password
          </a>
          <p style="color: #666; font-size: 12px;">This link expires in 1 hour.</p>
          <p style="color: #666; font-size: 12px;">If you didn't request this, please ignore this email.</p>
        </div>
      `
    });

    res.json({
      success: true,
      message: 'If an account exists with this email, a password reset link has been sent.'
    });

  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Failed to process password reset request' });
  }
});

// POST /api/user-auth/reset-password
// Reset password with token
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Find user with valid reset token
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    }).select('+resetPasswordToken +resetPasswordExpires');

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    // Update password
    user.password = newPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    console.log(`✅ Password reset: ${user.email}`);

    res.json({
      success: true,
      message: 'Password reset successful! You can now login with your new password.'
    });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Password reset failed' });
  }
});

// GET /api/user-auth/me
// Get current user (requires auth)
router.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = verifyAccessToken(token);
    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      user: user.toPublicJSON()
    });

  } catch (error) {
    console.error('Get user error:', error);
    res.status(401).json({ error: 'Invalid or expired token' });
  }
});

// PUT /api/user-auth/update-profile
// Update user profile (name only for now)
router.put('/update-profile', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const { verifyAccessToken } = require('../utils/token');
    const decoded = verifyAccessToken(token);
    
    const user = await User.findById(decoded.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { name } = req.body;

    if (name) user.name = name;
    
    await user.save();

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: user.toPublicJSON()
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// DELETE /api/user-auth/delete-account
// Delete user account
router.delete('/delete-account', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const { verifyAccessToken } = require('../utils/token');
    const decoded = verifyAccessToken(token);
    
    const user = await User.findById(decoded.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    await user.deleteOne();

    console.log(`❌ User account deleted: ${user.email}`);

    res.json({
      success: true,
      message: 'Account deleted successfully'
    });

  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

module.exports = router;