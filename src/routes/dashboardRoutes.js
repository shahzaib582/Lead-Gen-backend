const express = require('express');
const { authenticate } = require('../middleware/authenticate');
const validateRequest = require('../middleware/validateRequest');
const { campaignLimiter } = require('../config/rateLimits');
const dashboardController = require('../controllers/dashboardController');
const {
  summaryValidation,
  performanceValidation,
  activeCampaignsValidation,
  recentActivityValidation,
} = require('../validation/dashboardRoutesValidation');

const router = express.Router();

router.use(authenticate);
router.use(campaignLimiter);

router.get('/summary', summaryValidation, validateRequest, dashboardController.summary);
router.get('/meeting-stats', summaryValidation, validateRequest, dashboardController.meetingStats);
router.get('/performance', performanceValidation, validateRequest, dashboardController.performance);
router.get(
  '/active-campaigns',
  activeCampaignsValidation,
  validateRequest,
  dashboardController.activeCampaigns
);
router.get(
  '/recent-activity',
  recentActivityValidation,
  validateRequest,
  dashboardController.recentActivity
);

module.exports = router;
