const { validationResult } = require('express-validator');
const AppError = require('../utils/AppError');

/**
 * Express middleware: fail with 422 if express-validator found errors.
 * Place after validator arrays on the route.
 */
function validateRequest(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const messages = errors
      .array()
      .map((e) => e.msg)
      .join(', ');
    return next(new AppError(messages, 422));
  }
  next();
}

module.exports = validateRequest;
