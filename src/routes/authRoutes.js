const express = require('express');
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { createRateLimitHandler } = require('../utils/response');
const authController = require('../controllers/authController');
const { authenticate } = require('../middleware/authenticate');

const router = express.Router();

// ─── Rate limiters ────────────────────────────────────────────────────────────

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  handler: createRateLimitHandler('Too many requests. Please try again later.'),
  standardHeaders: true,
  legacyHeaders: false,
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  handler: createRateLimitHandler('Too many login attempts. Please try again later.'),
  standardHeaders: true,
  legacyHeaders: false,
});

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  handler: createRateLimitHandler('Too many refresh requests.'),
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Validation ───────────────────────────────────────────────────────────────

const signupValidation = [
  body('email').isEmail().withMessage('Please provide a valid email address.').normalizeEmail(),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters.')
    .matches(/[A-Z]/)
    .withMessage('Password must contain at least one uppercase letter.')
    .matches(/[a-z]/)
    .withMessage('Password must contain at least one lowercase letter.')
    .matches(/[0-9]/)
    .withMessage('Password must contain at least one number.')
    .matches(/[^A-Za-z0-9]/)
    .withMessage('Password must contain at least one special character.'),
];

const verifyOtpValidation = [
  body('userId').isUUID().withMessage('Invalid user ID.'),
  body('otp')
    .isLength({ min: 6, max: 6 })
    .withMessage('OTP must be exactly 6 digits.')
    .isNumeric()
    .withMessage('OTP must be numeric.'),
];

const loginValidation = [
  body('email').isEmail().withMessage('Please provide a valid email address.').normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required.'),
];

const resendOtpValidation = [body('userId').isUUID().withMessage('Invalid user ID.')];

// ─── Routes ───────────────────────────────────────────────────────────────────

router.post('/signup', authLimiter, signupValidation, authController.signup);
router.post('/verify-otp', authLimiter, verifyOtpValidation, authController.verifyOtp);
router.post('/login', loginLimiter, loginValidation, authController.login);
router.post('/resend-otp', authLimiter, resendOtpValidation, authController.resendOtp);

// Refresh & Logout (no access token required — uses refresh token in body)
router.post('/refresh', refreshLimiter, authController.refreshTokens);
router.post('/logout', authController.logout);

// Logout all devices (requires valid access token)
router.post('/logout-all', authenticate, authController.logoutAll);

module.exports = router;
