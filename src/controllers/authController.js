const userService = require('../services/userService');
const otpService = require('../services/otpService');
const emailService = require('../services/emailService');
const { issueTokenPair } = require('../services/authTokenService');
const refreshTokenService = require('../services/refreshTokenService');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { successResponse } = require('../utils/response');
const { toPublicUser } = require('../utils/userPublic');

function logEmailFailure(label, email, err) {
  logger.error(label, {
    email,
    error: err?.message || String(err),
    code: err?.code,
    response: err?.response,
  });
}

/** Fire-and-forget; always attach .catch so Brevo OTP send failures do not become unhandledRejection. */
function sendOtpEmailInBackground(email, otp) {
  void emailService
    .sendOtpEmail(email, otp)
    .catch((err) => logEmailFailure('sendOtpEmail failed', email, err));
}

function sendPasswordResetOtpEmailInBackground(email, otp) {
  void emailService
    .sendPasswordResetOtpEmail(email, otp)
    .catch((err) => logEmailFailure('sendPasswordResetOtpEmail failed', email, err));
}

async function signup(req, res, next) {
  try {
    const { email, password, name, address, contact } = req.body;

    const user = await userService.createUser(email, password, {
      name,
      address,
      contact,
    });
    const otp = await otpService.createOtp(
      user.id,
      user.email,
      otpService.OTP_PURPOSE_EMAIL_VERIFY
    );
    sendOtpEmailInBackground(user.email, otp);

    return successResponse(
      res,
      201,
      'Account created. Check your email for your 6-digit verification code.',
      { email: user.email }
    );
  } catch (err) {
    next(err);
  }
}

async function verifyOtp(req, res, next) {
  try {
    const { email, otp } = req.body;

    const user = await userService.findUserByEmailIncludingDeleted(email);
    if (!user) throw new AppError('User not found.', 404);
    userService.assertUserActive(user);
    if (user.is_verified) throw new AppError('Email is already verified.', 400);

    await otpService.verifyOtp(user.id, otp);
    await userService.markUserVerified(user.id);

    const freshUser = await userService.findUserById(user.id);
    const { accessToken, refreshToken } = await issueTokenPair(freshUser);

    return successResponse(res, 200, 'Email verified successfully.', {
      accessToken,
      refreshToken,
      user: toPublicUser(freshUser),
    });
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    const INVALID_MSG = 'Invalid email or password.';

    const anyUser = await userService.findUserByEmailIncludingDeleted(email);
    if (anyUser && userService.isUserDeleted(anyUser)) {
      userService.assertUserActive(anyUser);
    }

    const user =
      anyUser && !userService.isUserDeleted(anyUser) ? anyUser : null;
    const dummyHash = '$2a$12$invalidhashfortimingprotectiononly000000000000000000000';
    const passwordMatch = user
      ? await userService.checkPassword(password, user.password_hash)
      : await userService.checkPassword(password, dummyHash).catch(() => false);

    if (!user || !passwordMatch) throw new AppError(INVALID_MSG, 401);

    if (!user.is_verified) {
      const otp = await otpService.createOtp(
        user.id,
        user.email,
        otpService.OTP_PURPOSE_EMAIL_VERIFY
      );
      sendOtpEmailInBackground(user.email, otp);
      throw new AppError(
        'Email not verified. A new verification code has been sent to your email.',
        403,
        'EMAIL_NOT_VERIFIED'
      );
    }

    const { accessToken, refreshToken } = await issueTokenPair(user);

    return successResponse(res, 200, 'Login successful.', {
      accessToken,
      refreshToken,
      user: toPublicUser(user),
    });
  } catch (err) {
    next(err);
  }
}

async function refreshTokens(req, res, next) {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) throw new AppError('Refresh token is required.', 400);

    const record = await refreshTokenService.validateRefreshToken(refreshToken);

    const user = await userService.findUserById(record.user_id);
    if (!user) throw new AppError('User not found.', 401);
    userService.assertUserActive(user);

    await refreshTokenService.deleteRefreshToken(record.id);
    const { accessToken, refreshToken: newRefreshToken } = await issueTokenPair(user);

    return successResponse(res, 200, 'Tokens refreshed successfully.', {
      accessToken,
      refreshToken: newRefreshToken,
    });
  } catch (err) {
    next(err);
  }
}

async function logout(req, res, next) {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await refreshTokenService.revokeRefreshToken(refreshToken);
    }
    return successResponse(res, 200, 'Logged out successfully.', undefined);
  } catch (err) {
    next(err);
  }
}

async function logoutAll(req, res, next) {
  try {
    await refreshTokenService.revokeAllUserRefreshTokens(req.user.id);
    return successResponse(res, 200, 'Logged out from all devices.', undefined);
  } catch (err) {
    next(err);
  }
}

// Password reset OTP only — resend by calling this again; purpose is server-side, not in request body.
async function forgotPassword(req, res, next) {
  try {
    const { email } = req.body;
    const generic =
      'If an account with this email exists and has a password, a reset code has been sent.';

    const user = await userService.findUserByEmail(email);
    if (!user?.password_hash) {
      return successResponse(res, 200, generic, undefined);
    }

    const otp = await otpService.createOtp(
      user.id,
      user.email,
      otpService.OTP_PURPOSE_PASSWORD_RESET
    );
    sendPasswordResetOtpEmailInBackground(user.email, otp);

    return successResponse(res, 200, generic, undefined);
  } catch (err) {
    next(err);
  }
}

async function resetPassword(req, res, next) {
  try {
    const { email, otp, password } = req.body;

    const user = await userService.findUserByEmailIncludingDeleted(email);
    if (!user?.password_hash) {
      throw new AppError('Invalid or expired verification code.', 400);
    }
    userService.assertUserActive(user);

    await otpService.verifyOtp(user.id, otp, otpService.OTP_PURPOSE_PASSWORD_RESET);
    await userService.assertNewPasswordDiffersFromCurrent(password, user.password_hash);
    await userService.updatePassword(user.id, password);
    if (!user.is_verified) {
      await userService.markUserVerified(user.id);
    }
    await refreshTokenService.revokeAllUserRefreshTokens(user.id);

    return successResponse(res, 200, 'Password updated successfully.', undefined);
  } catch (err) {
    next(err);
  }
}

// Email verification only — password reset resend uses POST /auth/forgot-password (no purpose in body).
async function resendOtp(req, res, next) {
  try {
    const { email } = req.body;

    const user = await userService.findUserByEmailIncludingDeleted(email);
    if (!user) throw new AppError('User not found.', 404);
    userService.assertUserActive(user);
    if (user.is_verified) throw new AppError('Email is already verified.', 400);

    const otp = await otpService.createOtp(
      user.id,
      user.email,
      otpService.OTP_PURPOSE_EMAIL_VERIFY
    );
    sendOtpEmailInBackground(user.email, otp);

    return successResponse(
      res,
      200,
      'A new verification code has been sent to your email.',
      undefined
    );
  } catch (err) {
    next(err);
  }
}

module.exports = {
  signup,
  verifyOtp,
  login,
  forgotPassword,
  resetPassword,
  refreshTokens,
  logout,
  logoutAll,
  resendOtp,
};
