const express = require('express');
const calendlyAuthController = require('../controllers/calendlyAuthController');
const { authenticate } = require('../middleware/authenticate');
const { googleLimiter } = require('../config/rateLimits');

const router = express.Router();

router.get('/connect', authenticate, googleLimiter, calendlyAuthController.redirectToCalendlyConnect);
router.get('/callback', calendlyAuthController.handleCalendlyCallback);
router.get('/status', authenticate, calendlyAuthController.getCalendlyStatus);
router.delete('/disconnect', authenticate, calendlyAuthController.disconnectCalendly);

module.exports = router;
