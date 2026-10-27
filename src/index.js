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
    if (hostname === 'wawasancandle.com' || hostname.endsWith('.wawasancandle.com')) return true; // client custom domains (oms., app., ...)
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
app.use('/api/settings',      require('./routes/settings'));
app.use('/api/permissions',   require('./routes/permissions'));

// ─── Health check ───
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── 404 handler ───
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// ─── Error handler ───
// The SQL Account relay on the client's PC can only read what comes back to it, and
// the Vercel logs are not reachable from there (2026-10-27: one invoice 500'd on every
// sync with nothing to go on). A caller that sends the webhook secret is the relay, so
// it also gets the message, code and first stack frames, plus what Postgres says about
// a database error (its stack is the driver's, so the table/column/constraint carry the
// "where"). Everyone else still gets the bare line, as before.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err.stack || err);
  const body = { error: 'Internal server error' };
  const secret = process.env.SQL_ACCOUNT_WEBHOOK_SECRET;
  if (secret && req.headers['x-webhook-secret'] === secret) {
    body.detail = String((err && err.message) || err).slice(0, 500);
    if (err && err.code) body.code = err.code;
    if (err && err.type) body.type = err.type;
    if (err && err.stack) body.at = err.stack.split('\n').slice(1, 3).map((l) => l.trim());
    const pg = {};
    for (const k of ['detail', 'hint', 'table', 'column', 'constraint', 'routine', 'where']) {
      if (err && err[k]) pg[k] = String(err[k]).slice(0, 300);
    }
    if (Object.keys(pg).length) body.pg = pg;
  }
  res.status(500).json(body);
});

// Only start a listener when run directly (local dev / traditional host).
// On Vercel the app is imported by api/index.js and invoked per-request.
if (require.main === module) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════╗
║   Wawasan LTS OMS — Backend API          ║
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
