const express = require('express');
const {
  bulkAddValidation,
  listLeadsValidation,
  updateLeadValidation,
  removeLeadValidation,
  generateTemplatesValidation,
  sendEmailsValidation,
  runOutreachValidation,
  testerRunFollowUpsValidation,
} = require('../validation/campaignLeadsRoutesValidation');
const campaignLeadsController = require('../controllers/campaignLeadsController');
const mailTemplateController = require('../controllers/mailTemplateController');
const campaignMailerController = require('../controllers/campaignMailerController');
const campaignManualRunController = require('../controllers/campaignManualRunController');
const campaignTesterController = require('../controllers/campaignTesterController');
const { authenticate } = require('../middleware/authenticate');
const validateRequest = require('../middleware/validateRequest');
const { leadsLimiter } = require('../config/rateLimits');

const router = express.Router({ mergeParams: true });

router.use(authenticate);
router.use(leadsLimiter);

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
router.post(
  '/run',
  runOutreachValidation,
  validateRequest,
  campaignManualRunController.runOutreach
);
router.post(
  '/tester/follow-ups/run',
  testerRunFollowUpsValidation,
  validateRequest,
  campaignTesterController.runFollowUps
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
