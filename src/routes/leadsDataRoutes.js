const express = require('express');
const rateLimit = require('express-rate-limit');
const { createRateLimitHandler } = require('../utils/response');
const { listValidation, idValidation } = require('../validation/leadsDataRoutesValidation');
const leadsDataController = require('../controllers/leadsDataController');
const { authenticate } = require('../middleware/authenticate');

const router = express.Router();

// All leads routes require a valid JWT
router.use(authenticate);

// ─── Rate limiter ─────────────────────────────────────────────────────────────

const leadsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  handler: createRateLimitHandler('Too many requests. Please try again later.'),
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(leadsLimiter);

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /leads            — list all leads (with filters/search/pagination)
router.get('/', listValidation, leadsDataController.list);

// GET /leads/:id        — get a single lead by ID
router.get('/:id', idValidation, leadsDataController.getOne);

module.exports = router;
