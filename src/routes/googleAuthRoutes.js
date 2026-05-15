const express = require('express');
const googleAuthController = require('../controllers/googleAuthController');
const { authenticate } = require('../middleware/authenticate');
const { googleLimiter } = require('../config/rateLimits');

const router = express.Router();

router.get('/', googleLimiter, googleAuthController.redirectToGoogle);
router.get('/callback', googleAuthController.handleGoogleCallback);
router.post('/token', googleLimiter, googleAuthController.loginWithGoogleToken);
router.get('/status', authenticate, googleAuthController.getGoogleStatus);

module.exports = router;
