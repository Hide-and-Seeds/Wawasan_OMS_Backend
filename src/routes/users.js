// src/routes/users.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../utils/db');
const { authenticate, authorize } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

// Roles allowed to manage staff accounts (create / reset password / enable-disable).
const USER_MANAGERS = ['super_admin', 'operations_controller'];

// GET /api/users — staff list (managers only)
router.get('/', authenticate, authorize(...USER_MANAGERS), asyncHandler(async (req, res) => {
  const users = (await query(`
    SELECT id, name, email, role, avatar_color, is_active, created_at
    FROM users ORDER BY name ASC
  `)).rows;
  res.json(users);
}));

// GET /api/users/workload
router.get('/workload', authenticate, asyncHandler(async (req, res) => {
  const workload = (await query(`
    SELECT u.id, u.name, u.avatar_color, u.role,
      COUNT(o.id)::int AS active_orders
    FROM users u
    LEFT JOIN orders o ON o.pic_id = u.id AND o.stage NOT IN ('delivered','cancelled')
    WHERE u.is_active = true
    GROUP BY u.id
    ORDER BY active_orders DESC
  `)).rows;
  res.json(workload);
}));

// POST /api/users — create user (Super Admin or Ops Controller)
router.post('/', authenticate, authorize(...USER_MANAGERS), asyncHandler(async (req, res) => {
  const { name, email, role, password, avatar_color } = req.body;
  if (!name || !email || !role || !password) {
    return res.status(400).json({ error: 'name, email, role, password are required' });
  }
  if (role === 'super_admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Only a Super Admin can create another Super Admin' });
  }

  const existing = (await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()])).rows[0];
  if (existing) return res.status(409).json({ error: 'Email already exists' });

  const id = uuidv4();
  const hashed = bcrypt.hashSync(password, 10);
  await query(`
    INSERT INTO users (id, name, email, password, role, avatar_color)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [id, name, email.toLowerCase(), hashed, role, avatar_color || '#3B82F6']);

  res.status(201).json({ id, name, email, role });
}));

// PATCH /api/users/:id — update / reset password / enable-disable
router.patch('/:id', authenticate, authorize(...USER_MANAGERS), asyncHandler(async (req, res) => {
  const target = (await query('SELECT id, role FROM users WHERE id = $1', [req.params.id])).rows[0];
  if (!target) return res.status(404).json({ error: 'User not found' });

  const { name, role, avatar_color, is_active, password } = req.body;

  // Only a Super Admin may modify a Super Admin account or grant the Super Admin role.
  if ((target.role === 'super_admin' || role === 'super_admin') && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Only a Super Admin can manage Super Admin accounts' });
  }

  const updates = [];
  const values = [];

  if (name !== undefined) { updates.push(`name = $${values.push(name)}`); }
  if (role !== undefined) { updates.push(`role = $${values.push(role)}`); }
  if (avatar_color !== undefined) { updates.push(`avatar_color = $${values.push(avatar_color)}`); }
  if (is_active !== undefined) { updates.push(`is_active = $${values.push(Boolean(is_active))}`); }
  if (password) { updates.push(`password = $${values.push(bcrypt.hashSync(password, 10))}`); }

  if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });
  updates.push('updated_at = now()');
  const idIdx = values.push(req.params.id);

  await query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${idIdx}`, values);
  res.json({ message: 'User updated' });
}));

module.exports = router;
