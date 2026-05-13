const express = require('express');
const rateLimit = require('express-rate-limit');
const { createRateLimitHandler } = require('../utils/response');
const { sendEmailValidation } = require('../validation/emailRoutesValidation');
const emailController = require('../controllers/emailController');
const { authenticate } = require('../middleware/authenticate');

const router = express.Router();

// All email routes require authentication
router.use(authenticate);

// ─── Rate limiter ─────────────────────────────────────────────────────────────

const emailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // limit each user to 50 email sends per windowMs
  handler: createRateLimitHandler('Too many email requests. Please try again later.'),
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── POST /emails/send ───────────────────────────────────────────────────────
// Send a custom email using the user's Google access token

router.post('/send', emailLimiter, sendEmailValidation, emailController.sendEmail);

module.exports = router;
