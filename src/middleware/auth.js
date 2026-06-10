// src/middleware/auth.js
const jwt = require('jsonwebtoken');
const { query } = require('../utils/db');

async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = header.slice(7);
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  try {
    const { rows } = await query(
      'SELECT id, name, email, role, avatar_color, is_active FROM users WHERE id = $1',
      [payload.userId]
    );
    const user = rows[0];

    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Invalid or disabled account' });
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

function authorize(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

function canMoveOrders(req, res, next) {
  const allowed = ['super_admin'];
  if (!allowed.includes(req.user.role)) {
    return res.status(403).json({ error: 'Only the Boss can move orders' });
  }
  next();
}

module.exports = { authenticate, authorize, canMoveOrders };
