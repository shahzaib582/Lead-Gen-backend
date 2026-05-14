const express = require('express');
const rateLimit = require('express-rate-limit');
const { createRateLimitHandler } = require('../utils/response');
const {
  createValidation,
  updateValidation,
  idValidation,
  listValidation,
} = require('../validation/campaignRoutesValidation');
const campaignController = require('../controllers/campaignController');
const campaignEventsController = require('../controllers/campaignEventsController');
const campaignLeadsRoutes = require('./campaignLeadsRoutes');
const { authenticate } = require('../middleware/authenticate');

const router = express.Router();

const campaignLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  handler: createRateLimitHandler('Too many campaign requests. Please try again later.'),
  standardHeaders: true,
  legacyHeaders: false,
});

// SSE: GET must work without Bearer (auth via ?sid=); POST session uses Bearer.
router.post(
  '/:id/events/session',
  campaignLimiter,
  authenticate,
  idValidation,
  campaignEventsController.createEventsSession
);
router.get('/:id/events', campaignLimiter, idValidation, campaignEventsController.streamCampaignEvents);

// All other campaign routes require JWT
router.use(authenticate);
router.use(campaignLimiter);

// Nested: /campaigns/:id/leads/* — before /:id CRUD
router.use('/:id/leads', campaignLeadsRoutes);

router.post('/', createValidation, campaignController.create);
router.get('/', listValidation, campaignController.list);
router.get('/:id', idValidation, campaignController.getOne);
router.patch('/:id', updateValidation, campaignController.update);
router.delete('/:id', idValidation, campaignController.remove);

module.exports = router;
