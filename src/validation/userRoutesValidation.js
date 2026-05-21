const { body } = require('express-validator');
const { isValidIanaTimezone } = require('../utils/timezone');

const patchUserValidation = [
  body('name').optional({ nullable: true }).isString().trim().isLength({ max: 200 }),
  body('profile_pic').optional({ nullable: true }).isString().trim().isLength({ max: 2048 }),
  body('profilePic').optional({ nullable: true }).isString().trim().isLength({ max: 2048 }),
  body('address').optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
  body('contact').optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
  body('timezone')
    .optional({ nullable: true })
    .custom((value) => {
      if (value == null || value === '') return true;
      if (!isValidIanaTimezone(value)) {
        throw new Error('timezone must be a valid IANA name (e.g. America/New_York).');
      }
      return true;
    }),
  body('notificationsEnabled').optional().isBoolean().withMessage('notificationsEnabled must be a boolean.'),
  body('notifications_enabled').optional().isBoolean().withMessage('notifications_enabled must be a boolean.'),
  body('oldPassword').optional().isString().withMessage('oldPassword must be a string.'),
  body('old_password').optional().isString().withMessage('old_password must be a string.'),
  body('password')
    .optional()
    .custom((value, { req }) => {
      if (value === undefined || value === null || value === '') return true;
      const old = req.body.oldPassword ?? req.body.old_password;
      if (!old || String(old).trim() === '') {
        throw new Error('oldPassword is required when changing password.');
      }
      return true;
    })
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters.')
    .matches(/[A-Z]/)
    .withMessage('Password must contain at least one uppercase letter.')
    .matches(/[a-z]/)
    .withMessage('Password must contain at least one lowercase letter.')
    .matches(/[0-9]/)
    .withMessage('Password must contain at least one number.')
    .matches(/[^A-Za-z0-9]/)
    .withMessage('Password must contain at least one special character.'),
];

module.exports = { patchUserValidation };
