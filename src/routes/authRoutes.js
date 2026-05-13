const express = require('express');
const rateLimit = require('express-rate-limit');
const { createRateLimitHandler } = require('../utils/response');
const {
  signupValidation,
  verifyOtpValidation,
  loginValidation,
  resendOtpValidation,
} = require('../validation/authRoutesValidation');
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
