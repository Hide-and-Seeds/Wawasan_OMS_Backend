// src/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

// ─── Middleware ───
// Allowed origins: an explicit list from FRONTEND_URL (comma-separated), plus any
// *.vercel.app host (Vercel gives each production AND preview deploy its own unique
// hostname) and local dev. CORS isn't the auth boundary here — the API is guarded by
// JWT bearer tokens (not cookies), so a token can't be read cross-origin — which makes
// allowing Vercel hosts safe and saves us from chasing changing preview URLs.
const explicitOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

function isAllowedOrigin(origin) {
  if (!origin) return true; // non-browser clients / same-origin requests
  if (explicitOrigins.includes(origin)) return true;
  try {
    const { hostname } = new URL(origin);
    if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
    if (hostname.endsWith('.vercel.app')) return true; // production + preview deploys
  } catch {
    // malformed Origin header — fall through to deny
  }
  return false;
}

app.use(cors({
  origin(origin, cb) {
    // Deny by returning false (NOT by throwing — a throw would surface as a 500).
    cb(null, isAllowedOrigin(origin));
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
