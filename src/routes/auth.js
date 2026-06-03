// src/routes/auth.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../utils/db');
const { authenticate } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

// POST /api/auth/login
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const { rows } = await query(
    'SELECT * FROM users WHERE email = $1 AND is_active = true',
    [email.toLowerCase().trim()]
  );
  const user = rows[0];

  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { userId: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );

  // Log login
  await query(
    `INSERT INTO activity_log (id, user_id, action, details, ip_address)
     VALUES ($1, $2, 'login', $3, $4)`,
    [uuidv4(), user.id, `User ${user.name} logged in`, req.ip || null]
  );

  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar_color: user.avatar_color
    }
  });
}));

// POST /api/auth/logout
router.post('/logout', authenticate, asyncHandler(async (req, res) => {
  await query(
    `INSERT INTO activity_log (id, user_id, action, details, ip_address)
     VALUES ($1, $2, 'logout', $3, $4)`,
    [uuidv4(), req.user.id, `User ${req.user.name} logged out`, req.ip || null]
  );
  res.json({ message: 'Logged out successfully' });
}));

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

// POST /api/auth/change-password
router.post('/change-password', authenticate, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Both passwords required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  const { rows } = await query('SELECT password FROM users WHERE id = $1', [req.user.id]);
  const user = rows[0];

  if (!user || !bcrypt.compareSync(currentPassword, user.password)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }

  const hashed = bcrypt.hashSync(newPassword, 10);
  await query('UPDATE users SET password = $1, updated_at = now() WHERE id = $2', [hashed, req.user.id]);

  res.json({ message: 'Password changed successfully' });
}));

// POST /api/auth/forgot-password
router.post('/forgot-password', asyncHandler(async (req, res) => {
  const { email } = req.body;
  const { rows } = await query(
    'SELECT id, name, email FROM users WHERE email = $1 AND is_active = true',
    [(email || '').toLowerCase().trim()]
  );
  const user = rows[0];

  // Always return success to prevent email enumeration
  if (!user) return res.json({ message: 'If that email exists, a reset link has been sent.' });

  const token = uuidv4();
  const expiresAt = new Date(Date.now() + 3600000).toISOString(); // 1 hour

  await query(
    `INSERT INTO password_reset_tokens (id, user_id, token, expires_at) VALUES ($1, $2, $3, $4)`,
    [uuidv4(), user.id, token, expiresAt]
  );

  // TODO: Send email with token link
  console.log(`[Password Reset] Token for ${email}: ${token}`);

  res.json({ message: 'If that email exists, a reset link has been sent.' });
}));

// POST /api/auth/reset-password
router.post('/reset-password', asyncHandler(async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'Valid token and password (min 8 chars) required' });
  }

  const { rows } = await query(
    `SELECT * FROM password_reset_tokens
     WHERE token = $1 AND used = false AND expires_at > now()`,
    [token]
  );
  const record = rows[0];

  if (!record) return res.status(400).json({ error: 'Invalid or expired reset token' });

  const hashed = bcrypt.hashSync(newPassword, 10);
  await query('UPDATE users SET password = $1, updated_at = now() WHERE id = $2', [hashed, record.user_id]);
  await query('UPDATE password_reset_tokens SET used = true WHERE id = $1', [record.id]);

  res.json({ message: 'Password reset successfully' });
}));

module.exports = router;
