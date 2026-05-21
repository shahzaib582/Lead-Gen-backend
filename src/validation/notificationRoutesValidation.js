const { query, param } = require('express-validator');

const pageQuery = query('page')
  .optional()
  .isInt({ min: 1 })
  .withMessage('page must be a positive integer.')
  .toInt();

const limitQuery = query('limit')
  .optional()
  .isInt({ min: 1, max: 50 })
  .withMessage('limit must be between 1 and 50.')
  .toInt();

const unreadQuery = query('unread')
  .optional()
  .isIn(['true', 'false', '1', '0'])
  .withMessage('unread must be true or false.');

const notificationIdParam = param('id').isUUID().withMessage('id must be a valid UUID.');

const listValidation = [pageQuery, limitQuery, unreadQuery];
const markReadValidation = [notificationIdParam];

module.exports = {
  listValidation,
  markReadValidation,
};
