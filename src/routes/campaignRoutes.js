const express  = require('express');
const { body, param, query } = require('express-validator');
const rateLimit = require('express-rate-limit');
const campaignController = require('../controllers/campaignController');
const { authenticate }   = require('../middleware/authenticate');

const router = express.Router();

// All campaign routes require a valid access token
router.use(authenticate);

// ─── Rate limiter ─────────────────────────────────────────────────────────────

const campaignLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many campaign requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(campaignLimiter);

// ─── Validation rules ─────────────────────────────────────────────────────────

const RUN_MODES = ['manual', 'scheduled', 'auto'];
const STATUSES  = ['draft', 'active', 'paused', 'completed'];

const createValidation = [
  body('name')
    .trim().notEmpty().withMessage('Campaign name is required.')
    .isLength({ max: 200 }).withMessage('Name must be under 200 characters.'),

  body('goal')
    .trim().notEmpty().withMessage('Campaign goal is required.')
    .isLength({ max: 500 }).withMessage('Goal must be under 500 characters.'),

  body('target_zone')
    .trim().notEmpty().withMessage('Target zone is required.')
    .isLength({ max: 300 }).withMessage('Target zone must be under 300 characters.'),

  body('call_to_action')
    .trim().notEmpty().withMessage('Call to action is required.')
    .isLength({ max: 200 }).withMessage('Call to action must be under 200 characters.'),

  body('run_mode')
    .isIn(RUN_MODES)
    .withMessage(`Run mode must be one of: ${RUN_MODES.join(', ')}.`),

  body('mail_template')
    .optional({ nullable: true })
    .isString().withMessage('Mail template must be a string.'),

  body('example_training')
    .optional({ nullable: true })
    .isString().withMessage('Example training must be a string.'),

  body('target_leads')
    .optional()
    .isInt({ min: 0 }).withMessage('Target leads must be a non-negative integer.')
    .toInt(),

  body('status')
    .optional()
    .isIn(STATUSES)
    .withMessage(`Status must be one of: ${STATUSES.join(', ')}.`),
];

const updateValidation = [
  param('id').isUUID().withMessage('Invalid campaign ID.'),

  body('name')
    .optional()
    .trim().notEmpty().withMessage('Campaign name cannot be empty.')
    .isLength({ max: 200 }).withMessage('Name must be under 200 characters.'),

  body('goal')
    .optional()
    .trim().notEmpty().withMessage('Goal cannot be empty.')
    .isLength({ max: 500 }).withMessage('Goal must be under 500 characters.'),

  body('target_zone')
    .optional()
    .trim().notEmpty().withMessage('Target zone cannot be empty.')
    .isLength({ max: 300 }).withMessage('Target zone must be under 300 characters.'),

  body('call_to_action')
    .optional()
    .trim().notEmpty().withMessage('Call to action cannot be empty.')
    .isLength({ max: 200 }).withMessage('Call to action must be under 200 characters.'),

  body('run_mode')
    .optional()
    .isIn(RUN_MODES)
    .withMessage(`Run mode must be one of: ${RUN_MODES.join(', ')}.`),

  body('mail_template')
    .optional({ nullable: true })
    .isString().withMessage('Mail template must be a string.'),

  body('example_training')
    .optional({ nullable: true })
    .isString().withMessage('Example training must be a string.'),

  body('target_leads')
    .optional()
    .isInt({ min: 0 }).withMessage('Target leads must be a non-negative integer.')
    .toInt(),

  body('status')
    .optional()
    .isIn(STATUSES)
    .withMessage(`Status must be one of: ${STATUSES.join(', ')}.`),
];

const idValidation = [
  param('id').isUUID().withMessage('Invalid campaign ID.'),
];

const listValidation = [
  query('status').optional().isIn(STATUSES).withMessage(`Status must be one of: ${STATUSES.join(', ')}.`),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer.').toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100.').toInt(),
];

// ─── Routes ───────────────────────────────────────────────────────────────────

// POST   /campaigns          — create a new campaign
router.post('/',    createValidation, campaignController.create);

// GET    /campaigns          — list all campaigns for the authenticated user
router.get('/',     listValidation,   campaignController.list);

// GET    /campaigns/:id      — get a single campaign
router.get('/:id',  idValidation,     campaignController.getOne);

// PATCH  /campaigns/:id      — partial update
router.patch('/:id', updateValidation, campaignController.update);

// DELETE /campaigns/:id      — delete a campaign
router.delete('/:id', idValidation,   campaignController.remove);

module.exports = router;
