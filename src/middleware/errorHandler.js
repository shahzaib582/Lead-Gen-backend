const logger = require('../utils/logger');
const { errorResponse } = require('../utils/response');

/**
 * Express global error handler.
 * Must be the LAST app.use() call.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const isProduction = process.env.NODE_ENV === 'production';

  // Operational errors: safe to expose message
  if (err.isOperational) {
    const extras = {};
    if (err.code) extras.code = err.code;
    return errorResponse(res, err.statusCode, err.message, extras);
  }

  // Programmer / unknown errors: log the full stack, return generic message
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  const message = isProduction ? 'Something went wrong. Please try again later.' : err.message;
  const extras = isProduction ? {} : { stack: err.stack };
  return errorResponse(res, 500, message, extras);
}

module.exports = errorHandler;
module.exports.errorHandler = errorHandler; // named export alias (safety)
