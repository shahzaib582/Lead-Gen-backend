const express = require('express');
const {
  addLeadValidation,
  bulkAddValidation,
  listLeadsValidation,
  updateLeadValidation,
  removeLeadValidation,
  generateTemplatesValidation,
  sendEmailsValidation,
} = require('../validation/campaignLeadsRoutesValidation');
const campaignLeadsController = require('../controllers/campaignLeadsController');
const mailTemplateController = require('../controllers/mailTemplateController');
const campaignMailerController = require('../controllers/campaignMailerController');
const { authenticate } = require('../middleware/authenticate');
const validateRequest = require('../middleware/validateRequest');
const { leadsLimiter } = require('../config/rateLimits');

const router = express.Router({ mergeParams: true });

router.use(authenticate);
router.use(leadsLimiter);

router.post('/', addLeadValidation, validateRequest, campaignLeadsController.addLead);
router.post('/bulk', bulkAddValidation, validateRequest, campaignLeadsController.bulkAddLeads);
router.post(
  '/generate-templates',
  generateTemplatesValidation,
  validateRequest,
  mailTemplateController.generateTemplates
);
router.post(
  '/send-emails',
  sendEmailsValidation,
  validateRequest,
  campaignMailerController.sendEmails
);
router.get('/', listLeadsValidation, validateRequest, campaignLeadsController.listLeads);
router.patch('/:leadId', updateLeadValidation, validateRequest, campaignLeadsController.updateLead);
router.delete(
  '/:leadId',
  removeLeadValidation,
  validateRequest,
  campaignLeadsController.removeLead
);

module.exports = router;
