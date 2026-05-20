const { body, param, query } = require('express-validator');

const VALID_STATUSES = ['pending', 'template_generated', 'sent', 'failed', 'skipped'];

const campaignIdParam = param('id').isUUID().withMessage('Invalid campaign ID.');

const leadIdParam = param('leadId').isUUID().withMessage('Invalid campaign lead ID.');

const bulkAddValidation = [
  campaignIdParam,
  body('leads')
    .isArray({ min: 1, max: 500 })
    .withMessage('leads must be a non-empty array of up to 500 items.'),
  body('leads.*.lead_data_id')
    .notEmpty()
    .withMessage('Each lead must have a lead_data_id.')
    .isString()
    .withMessage('lead_data_id must be a string.'),
];

const listLeadsValidation = [
  campaignIdParam,
  query('status')
    .optional()
    .isIn(VALID_STATUSES)
    .withMessage(`status must be one of: ${VALID_STATUSES.join(', ')}.`),
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('page must be a positive integer.')
    .toInt(),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('limit must be between 1 and 100.')
    .toInt(),
];

const updateLeadValidation = [
  campaignIdParam,
  leadIdParam,
  body('status')
    .optional({ values: 'falsy' })
    .isIn(VALID_STATUSES)
    .withMessage(`status must be one of: ${VALID_STATUSES.join(', ')}.`),
  body('sent_at')
    .optional({ nullable: true })
    .isISO8601()
    .withMessage('sent_at must be a valid ISO 8601 date.'),
  body('mail_template')
    .optional({ nullable: true })
    .isString()
    .withMessage('mail_template must be a string.')
    .isLength({ max: 50000 })
    .withMessage('mail_template must be under 50,000 characters.'),
  body('error_message')
    .optional({ nullable: true })
    .isString()
    .withMessage('error_message must be a string.'),
  body('reply_received')
    .optional()
    .isBoolean()
    .withMessage('reply_received must be a boolean.')
    .toBoolean(),
];

const removeLeadValidation = [campaignIdParam, leadIdParam];

const generateTemplatesValidation = [
  campaignIdParam,
  body('campaign_lead_id')
    .optional({ nullable: true })
    .isUUID()
    .withMessage('campaign_lead_id must be a valid UUID.'),
];

const sendEmailsValidation = [
  campaignIdParam,
  body('campaign_lead_id')
    .optional({ nullable: true })
    .isUUID()
    .withMessage('campaign_lead_id must be a valid UUID.'),
  body('access_token')
    .optional({ nullable: true })
    .isString()
    .withMessage('access_token must be a string.'),
];

const runOutreachValidation = [campaignIdParam];

module.exports = {
  campaignIdParam,
  leadIdParam,
  bulkAddValidation,
  listLeadsValidation,
  updateLeadValidation,
  removeLeadValidation,
  generateTemplatesValidation,
  sendEmailsValidation,
  runOutreachValidation,
};
