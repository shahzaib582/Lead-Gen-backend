const userService = require('../services/userService');
const otpService = require('../services/otpService');
const emailService = require('../services/emailService');
const { issueTokenPair } = require('../services/authTokenService');
const refreshTokenService = require('../services/refreshTokenService');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { successResponse } = require('../utils/response');
const { toPublicUser } = require('../utils/userPublic');

async function signup(req, res, next) {
  try {
    const { email, password, name, profile_pic, address, contact } = req.body;

    const user = await userService.createUser(email, password, {
      name,
      profile_pic,
      address,
      contact,
    });
    const otp = await otpService.createOtp(user.id, user.email);
    await emailService.sendOtpEmail(user.email, otp);

    logger.info('User signed up', { userId: user.id, email: user.email });

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

    const user = await userService.findUserByEmail(email);
    if (!user) throw new AppError('User not found.', 404);
    if (user.is_verified) throw new AppError('Email is already verified.', 400);

    await otpService.verifyOtp(user.id, otp);
    await userService.markUserVerified(user.id);

    const freshUser = await userService.findUserById(user.id);
    const { accessToken, refreshToken } = await issueTokenPair(freshUser);

    logger.info('User verified email', { userId: user.id });

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

    const user = await userService.findUserByEmail(email);
    const dummyHash = '$2a$12$invalidhashfortimingprotectiononly000000000000000000000';
    const passwordMatch = user
      ? await userService.checkPassword(password, user.password_hash)
      : await userService.checkPassword(password, dummyHash).catch(() => false);

    if (!user || !passwordMatch) throw new AppError(INVALID_MSG, 401);
    if (!user.is_verified) {
      throw new AppError('Email not verified. Please verify your email before logging in.', 403);
    }

    const { accessToken, refreshToken } = await issueTokenPair(user);

    logger.info('User logged in', { userId: user.id });

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

    await refreshTokenService.deleteRefreshToken(record.id);
    const { accessToken, refreshToken: newRefreshToken } = await issueTokenPair(user);

    logger.info('Tokens refreshed', { userId: user.id });

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
    logger.info('User logged out', { userId: req.user?.id });
    return successResponse(res, 200, 'Logged out successfully.', undefined);
  } catch (err) {
    next(err);
  }
}

async function logoutAll(req, res, next) {
  try {
    await refreshTokenService.revokeAllUserRefreshTokens(req.user.id);
    logger.info('User logged out from all devices', { userId: req.user.id });
    return successResponse(res, 200, 'Logged out from all devices.', undefined);
  } catch (err) {
    next(err);
  }
}

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
    await emailService.sendPasswordResetOtpEmail(user.email, otp);

    logger.info('Password reset OTP issued', { userId: user.id });
    return successResponse(res, 200, generic, undefined);
  } catch (err) {
    next(err);
  }
}

async function resetPassword(req, res, next) {
  try {
    const { email, otp, password } = req.body;

    const user = await userService.findUserByEmail(email);
    if (!user?.password_hash) {
      throw new AppError('Invalid or expired verification code.', 400);
    }

    await otpService.verifyOtp(user.id, otp, otpService.OTP_PURPOSE_PASSWORD_RESET);
    await userService.updatePassword(user.id, password);
    if (!user.is_verified) {
      await userService.markUserVerified(user.id);
    }
    await refreshTokenService.revokeAllUserRefreshTokens(user.id);

    const freshUser = await userService.findUserById(user.id);
    const { accessToken, refreshToken } = await issueTokenPair(freshUser);

    logger.info('Password reset completed', { userId: user.id });

    return successResponse(res, 200, 'Password updated successfully.', {
      accessToken,
      refreshToken,
      user: toPublicUser(freshUser),
    });
  } catch (err) {
    next(err);
  }
}

async function resendOtp(req, res, next) {
  try {
    const { email } = req.body;

    const user = await userService.findUserByEmail(email);
    if (!user) throw new AppError('User not found.', 404);
    if (user.is_verified) throw new AppError('Email is already verified.', 400);

    const otp = await otpService.createOtp(user.id, user.email);
    await emailService.sendOtpEmail(user.email, otp);

    logger.info('OTP resent', { userId: user.id });

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
