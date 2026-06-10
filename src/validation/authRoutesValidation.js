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
  body('role').custom((value) => {
    if (value !== undefined) {
      throw new Error('Role cannot be set at signup.');
    }
    return true;
  }),
  body('name').optional().trim().isLength({ max: 200 }).withMessage('Name must be at most 200 characters.'),
  body('profile_pic').custom((value) => {
    if (value !== undefined) {
      throw new Error('Profile image cannot be set at signup. Use POST /api/user/avatar after login.');
    }
    return true;
  }),
  body('profilePic').custom((value) => {
    if (value !== undefined) {
      throw new Error('Profile image cannot be set at signup. Use POST /api/user/avatar after login.');
    }
    return true;
  }),
  body('address').optional().trim().isLength({ max: 500 }).withMessage('address must be at most 500 characters.'),
  body('contact').optional().trim().isLength({ max: 120 }).withMessage('contact must be at most 120 characters.'),
];

const verifyOtpValidation = [
  body('email').isEmail().withMessage('Please provide a valid email address.'),
  body('otp')
    .isLength({ min: 6, max: 6 })
    .withMessage('OTP must be exactly 6 digits.')
    .isNumeric()
    .withMessage('OTP must be numeric.'),
];

const validateOtpValidation = [
  body('email').isEmail().withMessage('Please provide a valid email address.'),
  body('otp')
    .isLength({ min: 6, max: 6 })
    .withMessage('OTP must be exactly 6 digits.')
    .isNumeric()
    .withMessage('OTP must be numeric.'),
  body('purpose')
    .optional()
    .isIn(['email_verify', 'password_reset'])
    .withMessage('purpose must be email_verify or password_reset.'),
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
  validateOtpValidation,
  loginValidation,
  resendOtpValidation,
  forgotPasswordValidation,
  resetPasswordValidation,
};
