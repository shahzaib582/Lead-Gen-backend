const express = require('express');
const rateLimit = require('express-rate-limit');
const { createRateLimitHandler } = require('../utils/response');
const {
  addLeadValidation,
  bulkAddValidation,
  listLeadsValidation,
  updateLeadValidation,
  removeLeadValidation,
  assignRandomValidation,
  assignFilteredLeadsValidation,
  generateTemplatesValidation,
  sendEmailsValidation,
} = require('../validation/campaignLeadsRoutesValidation');
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
  handler: createRateLimitHandler('Too many requests. Please try again later.'),
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(leadsLimiter);

// ─── Route definitions ────────────────────────────────────────────────────────

// POST   /campaigns/:id/leads
router.post('/', addLeadValidation, campaignLeadsController.addLead);

// POST   /campaigns/:id/leads/bulk
// NOTE: /bulk must be registered BEFORE /:leadId to avoid being matched as a UUID
router.post('/bulk', bulkAddValidation, campaignLeadsController.bulkAddLeads);

// POST   /campaigns/:id/leads/assign-random
// Picks target_leads random rows from leads_data and assigns them to the campaign.
// NOTE: registered before /:leadId for the same reason as /bulk
router.post('/assign-random', assignRandomValidation, campaignLeadsController.assignRandomLeads);

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
  assignFilteredLeadsValidation,
  campaignLeadsController.assignFilteredLeads
);

// POST   /campaigns/:id/leads/generate-templates
// For every pending lead in the campaign, fetch enrichment data from
// linkedinscrapping + webscrapping, call Claude AI with the campaign template,
// and save the personalised result back to campaign_leads.mail_template.
// Optional body: { campaign_lead_id: "<uuid>" } to target a single lead.
router.post(
  '/generate-templates',
  generateTemplatesValidation,
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
router.post('/send-emails', sendEmailsValidation, campaignMailerController.sendEmails);

// GET    /campaigns/:id/leads
router.get('/', listLeadsValidation, campaignLeadsController.listLeads);

// PATCH  /campaigns/:id/leads/:leadId
router.patch('/:leadId', updateLeadValidation, campaignLeadsController.updateLead);

// DELETE /campaigns/:id/leads/:leadId
router.delete('/:leadId', removeLeadValidation, campaignLeadsController.removeLead);

module.exports = router;
