const { body } = require('express-validator');

const sendEmailValidation = [
  body('to')
    .custom((value) => {
      if (typeof value === 'string') {
        if (!value.includes('@')) {
          throw new Error('Invalid email address.');
        }
        return true;
      }
      if (Array.isArray(value)) {
        if (value.length === 0) {
          throw new Error('At least one email address is required.');
        }
        value.forEach((email) => {
          if (typeof email !== 'string' || !email.includes('@')) {
            throw new Error('Invalid email address in array.');
          }
        });
        return true;
      }
      throw new Error('Email addresses must be a string or array of strings.');
    })
    .customSanitizer((value) => {
      if (typeof value === 'string') {
        return value.toLowerCase().trim();
      }
      if (Array.isArray(value)) {
        return value.map((email) => email.toLowerCase().trim());
      }
      return value;
    }),

  body('subject')
    .trim()
    .notEmpty()
    .withMessage('Subject is required.')
    .isLength({ max: 200 })
    .withMessage('Subject must be under 200 characters.'),

  body('body')
    .trim()
    .notEmpty()
    .withMessage('Email body is required.')
    .isLength({ max: 10000 })
    .withMessage('Email body must be under 10,000 characters.'),

  body('html')
    .optional()
    .isLength({ max: 50000 })
    .withMessage('HTML content must be under 50,000 characters.'),
];

module.exports = {
  sendEmailValidation,
};
