const { query, param, body } = require('express-validator');

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

const fcmTokenBody = body('fcmToken')
  .isString()
  .trim()
  .isLength({ min: 20, max: 4096 })
  .withMessage('fcmToken must be a valid FCM registration token.');

const deviceLabelBody = body('deviceLabel')
  .optional({ nullable: true })
  .isString()
  .trim()
  .isLength({ max: 120 });

const listValidation = [pageQuery, limitQuery, unreadQuery];
const markReadValidation = [notificationIdParam];
const pushRegisterValidation = [fcmTokenBody, deviceLabelBody];
const pushUnregisterValidation = [fcmTokenBody];

module.exports = {
  listValidation,
  markReadValidation,
  pushRegisterValidation,
  pushUnregisterValidation,
};
