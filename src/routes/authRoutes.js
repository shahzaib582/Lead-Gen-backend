const express = require('express');
const {
  signupValidation,
  verifyOtpValidation,
  loginValidation,
  resendOtpValidation,
} = require('../validation/authRoutesValidation');
const authController = require('../controllers/authController');
const { authenticate } = require('../middleware/authenticate');
const validateRequest = require('../middleware/validateRequest');
const { authLimiter, loginLimiter, refreshLimiter } = require('../config/rateLimits');

const router = express.Router();

router.post('/signup', authLimiter, signupValidation, validateRequest, authController.signup);
router.post(
  '/verify-otp',
  authLimiter,
  verifyOtpValidation,
  validateRequest,
  authController.verifyOtp
);
router.post('/login', loginLimiter, loginValidation, validateRequest, authController.login);
router.post(
  '/resend-otp',
  authLimiter,
  resendOtpValidation,
  validateRequest,
  authController.resendOtp
);

router.post('/refresh', refreshLimiter, authController.refreshTokens);
router.post('/logout', authController.logout);

router.post('/logout-all', authenticate, authController.logoutAll);

module.exports = router;
