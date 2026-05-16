const express = require('express');
const {
  createValidation,
  updateValidation,
  idValidation,
  listValidation,
} = require('../validation/campaignRoutesValidation');
const campaignController = require('../controllers/campaignController');
const campaignEventsController = require('../controllers/campaignEventsController');
const campaignLeadsRoutes = require('./campaignLeadsRoutes');
const campaignFollowUpsRoutes = require('./campaignFollowUpsRoutes');
const { authenticate } = require('../middleware/authenticate');
const validateRequest = require('../middleware/validateRequest');
const { campaignLimiter } = require('../config/rateLimits');

const router = express.Router();

router.post(
  '/:id/events/session',
  campaignLimiter,
  authenticate,
  idValidation,
  validateRequest,
  campaignEventsController.createEventsSession
);
router.get(
  '/:id/events',
  campaignLimiter,
  idValidation,
  validateRequest,
  campaignEventsController.streamCampaignEvents
);

router.use(authenticate);
router.use(campaignLimiter);

router.use('/:id/leads', campaignLeadsRoutes);
router.use('/:id/follow-ups', campaignFollowUpsRoutes);

router.post('/', createValidation, validateRequest, campaignController.create);
router.get('/', listValidation, validateRequest, campaignController.list);
router.get('/:id', idValidation, validateRequest, campaignController.getOne);
router.patch('/:id', updateValidation, validateRequest, campaignController.update);
router.delete('/:id', idValidation, validateRequest, campaignController.remove);

module.exports = router;
