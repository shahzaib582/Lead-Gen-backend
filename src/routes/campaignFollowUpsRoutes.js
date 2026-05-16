const express = require('express');
const {
  listValidation,
  createValidation,
  getOneValidation,
  updateValidation,
  deleteValidation,
} = require('../validation/campaignFollowUpsRoutesValidation');
const campaignFollowUpsController = require('../controllers/campaignFollowUpsController');
const { authenticate } = require('../middleware/authenticate');
const validateRequest = require('../middleware/validateRequest');
const { campaignLimiter } = require('../config/rateLimits');

const router = express.Router({ mergeParams: true });

router.use(authenticate);
router.use(campaignLimiter);

router.get('/', listValidation, validateRequest, campaignFollowUpsController.list);
router.post('/', createValidation, validateRequest, campaignFollowUpsController.create);
router.get('/:followUpId', getOneValidation, validateRequest, campaignFollowUpsController.getOne);
router.patch('/:followUpId', updateValidation, validateRequest, campaignFollowUpsController.update);
router.delete('/:followUpId', deleteValidation, validateRequest, campaignFollowUpsController.remove);

module.exports = router;
