const express = require('express');
const { authenticate } = require('../middleware/authenticate');
const validateRequest = require('../middleware/validateRequest');
const { campaignLimiter } = require('../config/rateLimits');
const analyticsController = require('../controllers/analyticsController');
const {
  periodValidation,
  weeksQuery,
  campaignComparisonValidation,
} = require('../validation/analyticsRoutesValidation');

const router = express.Router();

router.use(authenticate);
router.use(campaignLimiter);

/** Top KPI cards + period-over-period deltas */
router.get('/overview', periodValidation, validateRequest, analyticsController.overview);

/** Multi-line chart: daily replies per campaign */
router.get(
  '/campaign-chart',
  periodValidation,
  validateRequest,
  analyticsController.campaignChart
);

/** Campaign comparison table (paginated) */
router.get(
  '/campaign-comparison',
  campaignComparisonValidation,
  validateRequest,
  analyticsController.campaignComparison
);

/** Grouped bar: sent vs replies by UTC week */
router.get(
  '/sent-vs-replies',
  weeksQuery,
  validateRequest,
  analyticsController.sentVsReplies
);

/** Donut / circle graph: 4 reply pipeline segments */
router.get(
  '/reply-breakdown',
  periodValidation,
  validateRequest,
  analyticsController.replyBreakdown
);

module.exports = router;
