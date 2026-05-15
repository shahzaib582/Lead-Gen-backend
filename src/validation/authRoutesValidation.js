const { body } = require('express-validator');

const signupValidation = [
  body('email').isEmail().withMessage('Please provide a valid email address.'),
  body('password')
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

const verifyOtpValidation = [
  body('email').isEmail().withMessage('Please provide a valid email address.'),
  body('otp')
    .isLength({ min: 6, max: 6 })
    .withMessage('OTP must be exactly 6 digits.')
    .isNumeric()
    .withMessage('OTP must be numeric.'),
];

const loginValidation = [
  body('email').isEmail().withMessage('Please provide a valid email address.'),
  body('password').notEmpty().withMessage('Password is required.'),
];

const resendOtpValidation = [
  body('email').isEmail().withMessage('Please provide a valid email address.'),
];

const forgotPasswordValidation = [
  body('email').isEmail().withMessage('Please provide a valid email address.'),
];

const resetPasswordValidation = [
  body('email').isEmail().withMessage('Please provide a valid email address.'),
  body('otp')
    .isLength({ min: 6, max: 6 })
    .withMessage('OTP must be exactly 6 digits.')
    .isNumeric()
    .withMessage('OTP must be numeric.'),
  body('password')
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

module.exports = {
  signupValidation,
  verifyOtpValidation,
  loginValidation,
  resendOtpValidation,
  forgotPasswordValidation,
  resetPasswordValidation,
};
