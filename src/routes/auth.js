// src/routes/auth.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../utils/db');
const { authenticate } = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(email.toLowerCase().trim());

  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { userId: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );

  // Log login
  db.prepare(`
    INSERT INTO activity_log (id, user_id, action, details, ip_address)
    VALUES (?, ?, 'login', ?, ?)
  `).run(uuidv4(), user.id, `User ${user.name} logged in`, req.ip);

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
});

// POST /api/auth/logout
router.post('/logout', authenticate, (req, res) => {
  const db = getDb();
  db.prepare(`
    INSERT INTO activity_log (id, user_id, action, details, ip_address)
    VALUES (?, ?, 'logout', ?, ?)
  `).run(uuidv4(), req.user.id, `User ${req.user.name} logged out`, req.ip);
  res.json({ message: 'Logged out successfully' });
});

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

// POST /api/auth/change-password
router.post('/change-password', authenticate, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Both passwords required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  const db = getDb();
  const user = db.prepare('SELECT password FROM users WHERE id = ?').get(req.user.id);

  if (!bcrypt.compareSync(currentPassword, user.password)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }

  const hashed = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password = ?, updated_at = datetime("now") WHERE id = ?')
    .run(hashed, req.user.id);

  res.json({ message: 'Password changed successfully' });
});

// POST /api/auth/forgot-password
router.post('/forgot-password', (req, res) => {
  const { email } = req.body;
  const db = getDb();
  const user = db.prepare('SELECT id, name, email FROM users WHERE email = ? AND is_active = 1').get(email);

  // Always return success to prevent email enumeration
  if (!user) return res.json({ message: 'If that email exists, a reset link has been sent.' });

  const token = uuidv4();
  const expiresAt = new Date(Date.now() + 3600000).toISOString(); // 1 hour

  db.prepare(`
    INSERT INTO password_reset_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)
  `).run(uuidv4(), user.id, token, expiresAt);

  // TODO: Send email with token link
  console.log(`[Password Reset] Token for ${email}: ${token}`);

  res.json({ message: 'If that email exists, a reset link has been sent.' });
});

// POST /api/auth/reset-password
router.post('/reset-password', (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'Valid token and password (min 8 chars) required' });
  }

  const db = getDb();
  const record = db.prepare(`
    SELECT * FROM password_reset_tokens
    WHERE token = ? AND used = 0 AND expires_at > datetime('now')
  `).get(token);

  if (!record) return res.status(400).json({ error: 'Invalid or expired reset token' });

  const hashed = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password = ?, updated_at = datetime("now") WHERE id = ?')
    .run(hashed, record.user_id);
  db.prepare('UPDATE password_reset_tokens SET used = 1 WHERE id = ?').run(record.id);

  res.json({ message: 'Password reset successfully' });
});

module.exports = router;
