const express = require('express');
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { createRateLimitHandler } = require('../utils/response');
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

// ─── Validation rules ─────────────────────────────────────────────────────────

const sendEmailValidation = [
  body('to')
    .custom((value) => {
      if (typeof value === 'string') {
        // Single email
        if (!value.includes('@')) {
          throw new Error('Invalid email address.');
        }
        return true;
      } else if (Array.isArray(value)) {
        // Multiple emails
        if (value.length === 0) {
          throw new Error('At least one email address is required.');
        }
        value.forEach((email) => {
          if (typeof email !== 'string' || !email.includes('@')) {
            throw new Error('Invalid email address in array.');
          }
        });
        return true;
      }
      throw new Error('Email addresses must be a string or array of strings.');
    })
    .customSanitizer((value) => {
      if (typeof value === 'string') {
        return value.toLowerCase().trim();
      } else if (Array.isArray(value)) {
        return value.map((email) => email.toLowerCase().trim());
      }
      return value;
    }),

  body('subject')
    .trim()
    .notEmpty()
    .withMessage('Subject is required.')
    .isLength({ max: 200 })
    .withMessage('Subject must be under 200 characters.'),

  body('body')
    .trim()
    .notEmpty()
    .withMessage('Email body is required.')
    .isLength({ max: 10000 })
    .withMessage('Email body must be under 10,000 characters.'),

  body('html')
    .optional()
    .isLength({ max: 50000 })
    .withMessage('HTML content must be under 50,000 characters.'),
];

// ─── POST /emails/send ───────────────────────────────────────────────────────
// Send a custom email using the user's Google access token

router.post('/send', emailLimiter, sendEmailValidation, emailController.sendEmail);

module.exports = router;
