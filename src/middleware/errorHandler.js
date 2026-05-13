const logger = require('../utils/logger');

/**
 * Express global error handler.
 * Must be the LAST app.use() call.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const isProduction = process.env.NODE_ENV === 'production';

  // Operational errors: safe to expose message
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
    });
  }

  // Programmer / unknown errors: log the full stack, return generic message
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  return res.status(500).json({
    success: false,
    message: isProduction ? 'Something went wrong. Please try again later.' : err.message,
    ...(isProduction ? {} : { stack: err.stack }),
  });
}

module.exports = errorHandler;
module.exports.errorHandler = errorHandler; // named export alias (safety)
