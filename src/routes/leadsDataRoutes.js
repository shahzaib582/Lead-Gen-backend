const express = require('express');
const { query, param } = require('express-validator');
const rateLimit = require('express-rate-limit');
const leadsDataController = require('../controllers/leadsDataController');
const { authenticate } = require('../middleware/authenticate');

const router = express.Router();

// All leads routes require a valid JWT
router.use(authenticate);

// ─── Rate limiter ─────────────────────────────────────────────────────────────

const leadsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { success: false, message: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(leadsLimiter);

// ─── Validation ───────────────────────────────────────────────────────────────

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

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /leads            — list all leads (with filters/search/pagination)
router.get('/', listValidation, leadsDataController.list);

// GET /leads/:id        — get a single lead by ID
router.get('/:id', idValidation, leadsDataController.getOne);

module.exports = router;
