const express = require('express');
const rateLimit = require('express-rate-limit');
const { createRateLimitHandler } = require('../utils/response');
const {
  createValidation,
  updateValidation,
  idValidation,
  listValidation,
} = require('../validation/campaignRoutesValidation');
const campaignController = require('../controllers/campaignController');
const campaignLeadsRoutes = require('./campaignLeadsRoutes');
const { authenticate } = require('../middleware/authenticate');

const router = express.Router();

// All campaign routes require a valid access token
router.use(authenticate);

// ─── Rate limiter ─────────────────────────────────────────────────────────────

const campaignLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  handler: createRateLimitHandler('Too many campaign requests. Please try again later.'),
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(campaignLimiter);

// ─── Nested: /campaigns/:id/leads/* ───────────────────────────────────────────
// Registered before /:id CRUD so paths like …/leads are not treated as a campaign id.
router.use('/:id/leads', campaignLeadsRoutes);

// ─── Routes ───────────────────────────────────────────────────────────────────

// POST   /campaigns          — create a new campaign
router.post('/', createValidation, campaignController.create);

// GET    /campaigns          — list all campaigns for the authenticated user
router.get('/', listValidation, campaignController.list);

// GET    /campaigns/:id      — get a single campaign
router.get('/:id', idValidation, campaignController.getOne);

// PATCH  /campaigns/:id      — partial update
router.patch('/:id', updateValidation, campaignController.update);

// DELETE /campaigns/:id      — delete a campaign
router.delete('/:id', idValidation, campaignController.remove);

module.exports = router;
