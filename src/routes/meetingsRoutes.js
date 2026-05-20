const express = require('express');
const { authenticate } = require('../middleware/authenticate');
const validateRequest = require('../middleware/validateRequest');
const { campaignLimiter } = require('../config/rateLimits');
const meetingsController = require('../controllers/meetingsController');
const {
  listMeetingsValidation,
  meetingIdParam,
  createMeetingValidation,
  updateMeetingValidation,
} = require('../validation/meetingsRoutesValidation');

const router = express.Router();

router.use(authenticate);
router.use(campaignLimiter);

router.get('/', listMeetingsValidation, validateRequest, meetingsController.list);
router.post('/', createMeetingValidation, validateRequest, meetingsController.create);
router.get('/:id', meetingIdParam, validateRequest, meetingsController.getOne);
router.patch('/:id', updateMeetingValidation, validateRequest, meetingsController.update);
router.delete('/:id', meetingIdParam, validateRequest, meetingsController.cancel);

module.exports = router;
