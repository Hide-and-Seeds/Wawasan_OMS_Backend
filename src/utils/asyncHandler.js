// src/utils/asyncHandler.js
// Wraps an async Express handler so rejected promises are forwarded to the
// error-handling middleware instead of becoming unhandled rejections.
module.exports = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
