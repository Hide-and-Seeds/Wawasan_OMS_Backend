// src/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

// ─── Middleware ───
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files
app.use('/uploads', express.static(path.resolve(process.env.UPLOAD_DIR || './uploads')));

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
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

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

💡 Run migrations first: node src/utils/migrate.js
💡 Then seed data:        node src/utils/seed.js
  `);
});

module.exports = app;
