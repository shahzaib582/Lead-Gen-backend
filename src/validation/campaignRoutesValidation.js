const { body, param, query } = require('express-validator');
const { assertMailTemplateSamplesValid } = require('../utils/mailTemplateSamples');

const RUN_MODES = ['manual', 'scheduled', 'auto'];
const STATUSES = ['draft', 'active', 'paused', 'completed'];
const LEAD_SOURCES = ['new', 'old', 'both'];
const TARGET_TONES = ['Friendly', 'Professional', 'Direct', 'Consultative'];

const createValidation = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Campaign name is required.')
    .isLength({ max: 200 })
    .withMessage('Name must be under 200 characters.'),

  body('goal')
    .trim()
    .notEmpty()
    .withMessage('Campaign goal is required.')
    .isLength({ max: 500 })
    .withMessage('Goal must be under 500 characters.'),

  body('target_zone')
    .trim()
    .notEmpty()
    .withMessage('Target zone is required.')
    .isLength({ max: 300 })
    .withMessage('Target zone must be under 300 characters.'),

  body('call_to_action')
    .trim()
    .notEmpty()
    .withMessage('Call to action is required.')
    .isLength({ max: 200 })
    .withMessage('Call to action must be under 200 characters.'),

  body('run_mode')
    .isIn(RUN_MODES)
    .withMessage(`Run mode must be one of: ${RUN_MODES.join(', ')}.`),

  body('target_tone')
    .optional()
    .isIn(TARGET_TONES)
    .withMessage(`target_tone must be one of: ${TARGET_TONES.join(', ')}.`),

  body('mail_training_instruction')
    .optional({ nullable: true })
    .isString()
    .withMessage('Mail training instruction must be a string.')
    .isLength({ max: 50_000 })
    .withMessage('Mail training instruction must be under 50,000 characters.'),

  body('mail_template_samples')
    .optional({ nullable: true })
    .custom((value) => {
      assertMailTemplateSamplesValid(value);
      return true;
    }),

  body('target_leads')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Target leads must be a non-negative integer.')
    .toInt(),

  body('lead_source')
    .optional()
    .isIn(LEAD_SOURCES)
    .withMessage(`lead_source must be one of: ${LEAD_SOURCES.join(', ')}.`),

  body('sender_display_name')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 120 })
    .withMessage('sender_display_name must be at most 120 characters.'),

  body('sender_address')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 500 })
    .withMessage('sender_address must be at most 500 characters.'),

  body('sender_phone')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 80 })
    .withMessage('sender_phone must be at most 80 characters.'),

  body('status')
    .optional()
    .isIn(STATUSES)
    .withMessage(`Status must be one of: ${STATUSES.join(', ')}.`),
];

const updateValidation = [
  param('id').isUUID().withMessage('Invalid campaign ID.'),

  body('name')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Campaign name cannot be empty.')
    .isLength({ max: 200 })
    .withMessage('Name must be under 200 characters.'),

  body('goal')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Goal cannot be empty.')
    .isLength({ max: 500 })
    .withMessage('Goal must be under 500 characters.'),

  body('target_zone')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Target zone cannot be empty.')
    .isLength({ max: 300 })
    .withMessage('Target zone must be under 300 characters.'),

  body('call_to_action')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Call to action cannot be empty.')
    .isLength({ max: 200 })
    .withMessage('Call to action must be under 200 characters.'),

  body('run_mode')
    .optional()
    .isIn(RUN_MODES)
    .withMessage(`Run mode must be one of: ${RUN_MODES.join(', ')}.`),

  body('target_tone')
    .optional()
    .isIn(TARGET_TONES)
    .withMessage(`target_tone must be one of: ${TARGET_TONES.join(', ')}.`),

  body('mail_training_instruction')
    .optional({ nullable: true })
    .isString()
    .withMessage('Mail training instruction must be a string.')
    .isLength({ max: 50_000 })
    .withMessage('Mail training instruction must be under 50,000 characters.'),

  body('mail_template_samples')
    .optional({ nullable: true })
    .custom((value) => {
      assertMailTemplateSamplesValid(value);
      return true;
    }),

  body('target_leads')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Target leads must be a non-negative integer.')
    .toInt(),

  body('lead_source')
    .optional()
    .isIn(LEAD_SOURCES)
    .withMessage(`lead_source must be one of: ${LEAD_SOURCES.join(', ')}.`),

  body('sender_display_name')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 120 })
    .withMessage('sender_display_name must be at most 120 characters.'),

  body('sender_address')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 500 })
    .withMessage('sender_address must be at most 500 characters.'),

  body('sender_phone')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 80 })
    .withMessage('sender_phone must be at most 80 characters.'),

  body('status')
    .optional()
    .isIn(STATUSES)
    .withMessage(`Status must be one of: ${STATUSES.join(', ')}.`),
];

const idValidation = [param('id').isUUID().withMessage('Invalid campaign ID.')];

const listValidation = [
  query('status')
    .optional()
    .isIn(STATUSES)
    .withMessage(`Status must be one of: ${STATUSES.join(', ')}.`),
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

module.exports = {
  createValidation,
  updateValidation,
  idValidation,
  listValidation,
};
