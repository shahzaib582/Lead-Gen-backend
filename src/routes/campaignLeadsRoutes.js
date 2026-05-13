const express = require('express');
const { body, param, query } = require('express-validator');
const rateLimit = require('express-rate-limit');
const campaignLeadsController = require('../controllers/campaignLeadsController');
const mailTemplateController = require('../controllers/mailTemplateController');
const campaignMailerController = require('../controllers/campaignMailerController');
const { authenticate } = require('../middleware/authenticate');

// mergeParams: true is REQUIRED so :id from the parent campaigns router is accessible
const router = express.Router({ mergeParams: true });

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

// ─── Shared validations ───────────────────────────────────────────────────────

const VALID_STATUSES = ['pending', 'sent', 'failed', 'skipped'];

const campaignIdParam = param('id').isUUID().withMessage('Invalid campaign ID.');

const leadIdParam = param('leadId').isUUID().withMessage('Invalid campaign lead ID.');

// ─── POST /campaigns/:id/leads ────────────────────────────────────────────────

const addLeadValidation = [
  campaignIdParam,
  body('lead_data_id')
    .notEmpty()
    .withMessage('lead_data_id is required.')
    .isString()
    .withMessage('lead_data_id must be a string.'),
  body('mail_template')
    .optional({ nullable: true })
    .isString()
    .withMessage('mail_template must be a string.')
    .isLength({ max: 50000 })
    .withMessage('mail_template must be under 50,000 characters.'),
];

// ─── POST /campaigns/:id/leads/bulk ──────────────────────────────────────────

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
  body('leads.*.mail_template')
    .optional({ nullable: true })
    .isString()
    .withMessage('mail_template must be a string.'),
];

// ─── GET /campaigns/:id/leads ─────────────────────────────────────────────────

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

// ─── PATCH /campaigns/:id/leads/:leadId ───────────────────────────────────────

const updateLeadValidation = [
  campaignIdParam,
  leadIdParam,
  body('status')
    .optional()
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
];

// ─── DELETE /campaigns/:id/leads/:leadId ──────────────────────────────────────

const removeLeadValidation = [campaignIdParam, leadIdParam];

// ─── Route definitions ────────────────────────────────────────────────────────

// POST   /campaigns/:id/leads
router.post('/', addLeadValidation, campaignLeadsController.addLead);

// POST   /campaigns/:id/leads/bulk
// NOTE: /bulk must be registered BEFORE /:leadId to avoid being matched as a UUID
router.post('/bulk', bulkAddValidation, campaignLeadsController.bulkAddLeads);

// POST   /campaigns/:id/leads/assign-random
// Picks target_leads random rows from leads_data and assigns them to the campaign.
// NOTE: registered before /:leadId for the same reason as /bulk
router.post('/assign-random', [campaignIdParam], campaignLeadsController.assignRandomLeads);

// POST   /campaigns/:id/leads/assign-filtered
// Picks leads from leads_data filtered by country and/or industry,
// then assigns them to the campaign.
// Body params:
//   country   (string, optional) — exact match on leads_data.country
//   industry  (string, optional) — exact match on leads_data.industry
//   limit     (integer, optional, 1–500) — max leads to assign; falls back to campaign.target_leads
// At least one of country or industry must be supplied.
router.post(
  '/assign-filtered',
  [
    campaignIdParam,
    body('country')
      .optional({ nullable: true })
      .isString()
      .withMessage('country must be a string.')
      .trim()
      .isLength({ max: 100 })
      .withMessage('country must be under 100 characters.'),
    body('industry')
      .optional({ nullable: true })
      .isString()
      .withMessage('industry must be a string.')
      .trim()
      .isLength({ max: 100 })
      .withMessage('industry must be under 100 characters.'),
    body('limit')
      .optional({ nullable: true })
      .isInt({ min: 1, max: 500 })
      .withMessage('limit must be between 1 and 500.')
      .toInt(),
  ],
  campaignLeadsController.assignFilteredLeads
);

// POST   /campaigns/:id/leads/generate-templates
// For every pending lead in the campaign, fetch enrichment data from
// linkedinscrapping + webscrapping, call Claude AI with the campaign template,
// and save the personalised result back to campaign_leads.mail_template.
// Optional body: { campaign_lead_id: "<uuid>" } to target a single lead.
router.post(
  '/generate-templates',
  [
    campaignIdParam,
    body('campaign_lead_id')
      .optional({ nullable: true })
      .isUUID()
      .withMessage('campaign_lead_id must be a valid UUID.'),
  ],
  mailTemplateController.generateTemplates
);

// POST   /campaigns/:id/leads/send-emails
// Send AI-generated emails to all pending leads that already have a mail_template.
// Features:
//   • Random delay (10s–60s, env-configurable) between each send
//   • Hard cap of 500 emails per UTC calendar day across all campaigns
//   • Mirrors send status back to leads_data (outreachStatus, emailSent, emailSentDate)
//
// Body params (all optional):
//   campaign_lead_id  — UUID: restrict send to a single lead
//   access_token      — Google OAuth2 token (falls back to req.user.googleAccessToken)
router.post(
  '/send-emails',
  [
    campaignIdParam,
    body('campaign_lead_id')
      .optional({ nullable: true })
      .isUUID()
      .withMessage('campaign_lead_id must be a valid UUID.'),
    body('access_token')
      .optional({ nullable: true })
      .isString()
      .withMessage('access_token must be a string.'),
  ],
  campaignMailerController.sendEmails
);

// GET    /campaigns/:id/leads
router.get('/', listLeadsValidation, campaignLeadsController.listLeads);

// PATCH  /campaigns/:id/leads/:leadId
router.patch('/:leadId', updateLeadValidation, campaignLeadsController.updateLead);

// DELETE /campaigns/:id/leads/:leadId
router.delete('/:leadId', removeLeadValidation, campaignLeadsController.removeLead);

module.exports = router;
