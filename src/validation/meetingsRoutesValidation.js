const { body, param, query } = require('express-validator');

const listMeetingsValidation = [
  query('status').optional().isIn(['scheduled', 'cancelled', 'completed']),
  query('campaign_id').optional().isUUID(),
  query('from').optional().isISO8601(),
  query('to').optional().isISO8601(),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
];

const meetingIdParam = [param('id').isUUID().withMessage('id must be a valid UUID.')];

const createMeetingValidation = [
  body('title').trim().notEmpty().isLength({ max: 300 }),
  body('description').optional({ nullable: true }).isString().isLength({ max: 5000 }),
  body('start_at').isISO8601().withMessage('start_at must be ISO 8601.'),
  body('end_at').isISO8601().withMessage('end_at must be ISO 8601.'),
  body('attendee_email').optional({ nullable: true }).isEmail(),
  body('campaign_id').optional({ nullable: true }).isUUID(),
  body('campaign_lead_id').optional({ nullable: true }).isUUID(),
  body('sync_google').optional().isBoolean().toBoolean(),
  body('add_google_meet').optional().isBoolean().toBoolean(),
];

const updateMeetingValidation = [
  ...meetingIdParam,
  body('title').optional().trim().notEmpty().isLength({ max: 300 }),
  body('description').optional({ nullable: true }).isString().isLength({ max: 5000 }),
  body('start_at').optional().isISO8601(),
  body('end_at').optional().isISO8601(),
  body('attendee_email').optional({ nullable: true }).isEmail(),
  body('status').optional().isIn(['scheduled', 'completed']),
];

module.exports = {
  listMeetingsValidation,
  meetingIdParam,
  createMeetingValidation,
  updateMeetingValidation,
};
