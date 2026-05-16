const { body, param } = require('express-validator');

const campaignIdParam = param('id').isUUID().withMessage('Invalid campaign ID.');

const followUpIdParam = param('followUpId').isUUID().withMessage('Invalid follow-up ID.');

const WAITING_DAYS_MIN = 0;
const WAITING_DAYS_MAX = 3650;

const listValidation = [campaignIdParam];

const createValidation = [
  campaignIdParam,
  body('name')
    .trim()
    .notEmpty()
    .withMessage('name is required.')
    .isLength({ max: 200 })
    .withMessage('name must be at most 200 characters.'),
  body('waiting_days')
    .isInt({ min: WAITING_DAYS_MIN, max: WAITING_DAYS_MAX })
    .withMessage(`waiting_days must be an integer between ${WAITING_DAYS_MIN} and ${WAITING_DAYS_MAX}.`)
    .toInt(),
];

const getOneValidation = [campaignIdParam, followUpIdParam];

const updateValidation = [
  campaignIdParam,
  followUpIdParam,
  body('name')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('name cannot be empty.')
    .isLength({ max: 200 })
    .withMessage('name must be at most 200 characters.'),
  body('waiting_days')
    .optional()
    .isInt({ min: WAITING_DAYS_MIN, max: WAITING_DAYS_MAX })
    .withMessage(`waiting_days must be an integer between ${WAITING_DAYS_MIN} and ${WAITING_DAYS_MAX}.`)
    .toInt(),
];

const deleteValidation = [campaignIdParam, followUpIdParam];

module.exports = {
  listValidation,
  createValidation,
  getOneValidation,
  updateValidation,
  deleteValidation,
};
