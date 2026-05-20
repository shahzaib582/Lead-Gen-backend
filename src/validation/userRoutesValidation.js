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
];

module.exports = { patchUserValidation };
