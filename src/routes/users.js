// src/routes/users.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../utils/db');
const { authenticate, authorize } = require('../middleware/auth');

// GET /api/users
router.get('/', authenticate, (req, res) => {
  const db = getDb();
  const users = db.prepare(`
    SELECT id, name, email, role, avatar_color, is_active, created_at
    FROM users ORDER BY name ASC
  `).all();
  res.json(users);
});

// GET /api/users/workload
router.get('/workload', authenticate, (req, res) => {
  const db = getDb();
  const workload = db.prepare(`
    SELECT u.id, u.name, u.avatar_color, u.role,
      COUNT(o.id) as active_orders
    FROM users u
    LEFT JOIN orders o ON o.pic_id = u.id AND o.stage NOT IN ('delivered','cancelled')
    WHERE u.is_active = 1
    GROUP BY u.id
    ORDER BY active_orders DESC
  `).all();
  res.json(workload);
});

// POST /api/users — create user (admin only)
router.post('/', authenticate, authorize('super_admin'), (req, res) => {
  const { name, email, role, password, avatar_color } = req.body;
  if (!name || !email || !role || !password) {
    return res.status(400).json({ error: 'name, email, role, password are required' });
  }

  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) return res.status(409).json({ error: 'Email already exists' });

  const id = uuidv4();
  const hashed = bcrypt.hashSync(password, 10);
  db.prepare(`
    INSERT INTO users (id, name, email, password, role, avatar_color)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, name, email.toLowerCase(), hashed, role, avatar_color || '#3B82F6');

  res.status(201).json({ id, name, email, role });
});

// PATCH /api/users/:id
router.patch('/:id', authenticate, authorize('super_admin'), (req, res) => {
  const db = getDb();
  const { name, role, avatar_color, is_active, password } = req.body;
  const updates = [];
  const values = [];

  if (name !== undefined) { updates.push('name = ?'); values.push(name); }
  if (role !== undefined) { updates.push('role = ?'); values.push(role); }
  if (avatar_color !== undefined) { updates.push('avatar_color = ?'); values.push(avatar_color); }
  if (is_active !== undefined) { updates.push('is_active = ?'); values.push(is_active ? 1 : 0); }
  if (password) { updates.push('password = ?'); values.push(bcrypt.hashSync(password, 10)); }

  if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });
  updates.push('updated_at = datetime("now")');
  values.push(req.params.id);

  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  res.json({ message: 'User updated' });
});

module.exports = router;
