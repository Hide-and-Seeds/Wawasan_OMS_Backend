// src/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

// ─── Middleware ───
// FRONTEND_URL may be a comma-separated list of allowed origins.
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, cb) {
    // Allow non-browser clients (no Origin header) and any whitelisted origin.
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Routes ───
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/orders',        require('./routes/orders'));
app.use('/api/users',         require('./routes/users'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/remarks',       require('./routes/remarks'));
app.use('/api/reports',       require('./routes/reports'));
app.use('/api/delivery',      require('./routes/delivery'));

// ─── Health check ───
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── 404 handler ───
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// ─── Error handler ───
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err.stack || err);
  res.status(500).json({ error: 'Internal server error' });
});

// Only start a listener when run directly (local dev / traditional host).
// On Vercel the app is imported by api/index.js and invoked per-request.
if (require.main === module) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════╗
║   Wawasan Candle OMS — Backend API       ║
║   Running on http://localhost:${PORT}       ║
╚══════════════════════════════════════════╝

📋 Routes:
   POST   /api/auth/login
   GET    /api/orders/kanban
   POST   /api/orders
   PATCH  /api/orders/:id
   POST   /api/orders/:id/move
   GET    /api/reports/dashboard
   GET    /api/reports/production
   GET    /api/reports/delivery

💡 Apply schema first:  npm run migrate
💡 Then seed data:      npm run seed
  `);
  });
}

module.exports = app;
