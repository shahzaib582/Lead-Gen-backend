const { query, param, body } = require('express-validator');

const VALID_SORT_COLUMNS = [
  'created_at',
  'fullName',
  'email',
  'company',
  'country',
  'fitScore',
  'dateAdded',
];
const VALID_SORT_ORDERS = ['asc', 'desc'];

const listValidation = [
  query('search')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Search term too long.'),

  query('emailStatus').optional().isString().trim(),
  query('country').optional().isString().trim(),
  query('state').optional().isString().trim(),
  query('city').optional().isString().trim(),
  query('industry').optional().isString().trim(),
  query('seniority').optional().isString().trim(),
  query('department').optional().isString().trim(),
  query('company').optional().isString().trim(),
  query('outreachStatus').optional().isString().trim(),
  query('fitTag').optional().isString().trim(),

  query('sortBy')
    .optional()
    .isIn(VALID_SORT_COLUMNS)
    .withMessage(`sortBy must be one of: ${VALID_SORT_COLUMNS.join(', ')}.`),

  query('sortOrder')
    .optional()
    .isIn(VALID_SORT_ORDERS)
    .withMessage('sortOrder must be asc or desc.'),

  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer.')
    .toInt(),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100.')
    .toInt(),
];

const idValidation = [
  param('id').isInt({ min: 1 }).withMessage('Lead ID must be a positive integer.'),
];

const testerCreateValidation = [
  body('email').isEmail().withMessage('email must be a valid email address.'),
  body('fullName')
    .optional()
    .isString()
    .withMessage('fullName must be a string.')
    .isLength({ max: 200 })
    .withMessage('fullName must be at most 200 characters.'),
  body('firstName')
    .optional()
    .isString()
    .withMessage('firstName must be a string.')
    .isLength({ max: 120 })
    .withMessage('firstName must be at most 120 characters.'),
  body('company')
    .optional()
    .isString()
    .withMessage('company must be a string.')
    .isLength({ max: 200 })
    .withMessage('company must be at most 200 characters.'),
  body('title')
    .optional()
    .isString()
    .withMessage('title must be a string.')
    .isLength({ max: 200 })
    .withMessage('title must be at most 200 characters.'),
];

module.exports = {
  listValidation,
  idValidation,
  testerCreateValidation,
  VALID_SORT_COLUMNS,
  VALID_SORT_ORDERS,
};
