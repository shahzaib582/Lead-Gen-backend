const express = require('express');
const { sendEmailValidation } = require('../validation/emailRoutesValidation');
const emailController = require('../controllers/emailController');
const { authenticate } = require('../middleware/authenticate');
const validateRequest = require('../middleware/validateRequest');
const { emailLimiter } = require('../config/rateLimits');

const router = express.Router();

router.use(authenticate);

router.post('/send', emailLimiter, sendEmailValidation, validateRequest, emailController.sendEmail);

module.exports = router;
