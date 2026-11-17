const express = require('express');
const { body, param, query } = require('express-validator');
const validate = require('../middleware/validateRequest');
const service = require('../services/linkedHelperService');
const { successResponse } = require('../utils/response');

// Parent campaign router enforces authentication and rate limits.
const router = express.Router({ mergeParams: true });
router.use(param('id').isUUID(), validate);
const handle = (fn) => async (req, res, next) => {
  try {
    successResponse(res, 200, undefined, await fn(req));
  } catch (err) {
    next(err);
  }
};
router.get(
  '/configuration',
  handle((req) => service.configuration(req.user.id, req.params.id))
);
router.put(
  '/configuration',
  body('webhook_url').isString().isLength({ min: 1, max: 2048 }),
  validate,
  handle((req) => service.configure(req.user.id, req.params.id, req.body.webhook_url))
);
router.post(
  '/enroll',
  body('leads').isArray({ min: 1, max: 10 }),
  body('leads.*.campaign_lead_id').isUUID(),
  body('leads.*.retry_rejected').optional().isBoolean({ strict: true }),
  body('leads.*.message').optional().isString().isLength({ min: 1, max: 8000 }),
  validate,
  handle((req) => service.enrollLeads(req.user.id, req.params.id, req.body.leads))
);
router.get(
  '/enrollments',
  query('page').optional().isInt({ min: 1, max: 100000 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  validate,
  handle((req) =>
    service.listEnrollments(req.user.id, req.params.id, req.query.page || 1, req.query.limit || 20)
  )
);
module.exports = router;
