const express = require('express');
const { authenticate } = require('../middleware/authenticate');
const validateRequest = require('../middleware/validateRequest');
const { campaignLimiter } = require('../config/rateLimits');
const userController = require('../controllers/userController');
const { patchUserValidation } = require('../validation/userRoutesValidation');

const router = express.Router();

router.use(authenticate);
router.use(campaignLimiter);

router.get('/', userController.getCurrentUser);
router.patch('/', patchUserValidation, validateRequest, userController.patchCurrentUser);
router.delete('/', userController.deleteAccount);

module.exports = router;
