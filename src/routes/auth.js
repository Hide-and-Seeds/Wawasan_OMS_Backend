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

  // Session length is admin-configurable via the session_timeout_hours setting;
  // fall back to JWT_EXPIRES_IN (or 8h) when it isn't set.
  const timeoutRow = (await query("SELECT value FROM system_settings WHERE key = 'session_timeout_hours'")).rows[0];
  const hours = Math.max(1, parseInt(timeoutRow && timeoutRow.value, 10) || parseInt(process.env.JWT_EXPIRES_IN, 10) || 8);
  const token = jwt.sign(
    { userId: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: `${hours}h` }
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

// Password changes are admin-driven only for the factory deployment:
// Boss / Ops / Admin set any user's password via PATCH /api/users/:id.
// Self-service change-password and the email forgot/reset flow were removed.

module.exports = router;
