const express = require('express');
const rateLimit = require('express-rate-limit');
const googleAuthController = require('../controllers/googleAuthController');
const { authenticate }     = require('../middleware/authenticate');

const router = express.Router();

const googleLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { success: false, message: 'Too many Google auth requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Browser / redirect flow ──────────────────────────────────────────────────

// Step 1 — redirect browser to Google consent screen
// GET /auth/google
router.get('/', googleLimiter, googleAuthController.redirectToGoogle);

// Step 2 — Google redirects back here with ?code=...
// GET /auth/google/callback
router.get('/callback', googleAuthController.handleGoogleCallback);

// ─── Mobile / SPA flow ───────────────────────────────────────────────────────

// POST /auth/google/token
// Client sends Google ID token, gets back our JWT pair
router.post('/token', googleLimiter, googleAuthController.loginWithGoogleToken);

// ─── Account status (requires our JWT) ───────────────────────────────────────

// GET /auth/google/status
router.get('/status', authenticate, googleAuthController.getGoogleStatus);

module.exports = router;
