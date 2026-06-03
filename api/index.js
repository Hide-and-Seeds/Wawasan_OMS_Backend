// api/index.js
// Vercel serverless entry point. Vercel detects files under /api as functions;
// here we simply hand every request to the Express app, which does its own routing.
module.exports = require('../src/index.js');
