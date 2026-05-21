const { validationResult } = require('express-validator');
const AppError = require('../utils/AppError');

/**
 * Express middleware: fail with 422 if express-validator found errors.
 * Place after validator arrays on the route.
 */
function validateRequest(req, res, next) {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    const first = result.array()[0];
    return next(new AppError(first?.msg || 'Validation failed.', 422));
  }
  next();
}

module.exports = validateRequest;
