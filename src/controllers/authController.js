const { validationResult } = require('express-validator');
const userService = require('../services/userService');
const otpService = require('../services/otpService');
const emailService = require('../services/emailService');
const { generateAccessToken, generateRefreshToken } = require('../utils/jwt');
const refreshTokenService = require('../services/refreshTokenService');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

// ─── Helper ───────────────────────────────────────────────────────────────────

function handleValidationErrors(req) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const messages = errors
      .array()
      .map((e) => e.msg)
      .join(', ');
    throw new AppError(messages, 422);
  }
}

/**
 * Issue a fresh access + refresh token pair for a user and save the refresh
 * token to the database.
 */
async function issueTokenPair(user) {
  const accessToken = generateAccessToken(user);
  const rawRefresh = generateRefreshToken();
  await refreshTokenService.saveRefreshToken(user.id, rawRefresh);
  return { accessToken, refreshToken: rawRefresh };
}

// ─── Signup ───────────────────────────────────────────────────────────────────

async function signup(req, res, next) {
  try {
    handleValidationErrors(req);
    const { email, password } = req.body;

    const user = await userService.createUser(email, password);
    const otp = await otpService.createOtp(user.id, user.email);
    await emailService.sendOtpEmail(user.email, otp);

    logger.info('User signed up', { userId: user.id, email: user.email });

    return res.status(201).json({
      success: true,
      message: 'Account created. Check your email for your 6-digit verification code.',
      data: { userId: user.id },
    });
  } catch (err) {
    next(err);
  }
}

// ─── Verify OTP ───────────────────────────────────────────────────────────────

async function verifyOtp(req, res, next) {
  try {
    handleValidationErrors(req);
    const { userId, otp } = req.body;

    const user = await userService.findUserById(userId);
    if (!user) throw new AppError('User not found.', 404);
    if (user.is_verified) throw new AppError('Email is already verified.', 400);

    await otpService.verifyOtp(userId, otp);
    await userService.markUserVerified(userId);

    const { accessToken, refreshToken } = await issueTokenPair(user);

    logger.info('User verified email', { userId });

    return res.status(200).json({
      success: true,
      message: 'Email verified successfully.',
      data: { accessToken, refreshToken },
    });
  } catch (err) {
    next(err);
  }
}

// ─── Login ────────────────────────────────────────────────────────────────────

async function login(req, res, next) {
  try {
    handleValidationErrors(req);
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

    return res.status(200).json({
      success: true,
      message: 'Login successful.',
      data: {
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          isVerified: user.is_verified,
          createdAt: user.created_at,
        },
      },
    });
  } catch (err) {
    next(err);
  }
}

// ─── Refresh Token ────────────────────────────────────────────────────────────

/**
 * POST /auth/refresh
 * Body: { refreshToken }
 *
 * Token rotation: the old refresh token is deleted and a brand-new pair is issued.
 * This limits the window for replay attacks.
 */
async function refreshTokens(req, res, next) {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) throw new AppError('Refresh token is required.', 400);

    // Validate and fetch DB record
    const record = await refreshTokenService.validateRefreshToken(refreshToken);

    // Fetch user
    const user = await userService.findUserById(record.user_id);
    if (!user) throw new AppError('User not found.', 401);

    // Rotate: delete old refresh token, issue new pair
    await refreshTokenService.deleteRefreshToken(record.id);
    const { accessToken, refreshToken: newRefreshToken } = await issueTokenPair(user);

    logger.info('Tokens refreshed', { userId: user.id });

    return res.status(200).json({
      success: true,
      message: 'Tokens refreshed successfully.',
      data: { accessToken, refreshToken: newRefreshToken },
    });
  } catch (err) {
    next(err);
  }
}

// ─── Logout ───────────────────────────────────────────────────────────────────

/**
 * POST /auth/logout
 * Body: { refreshToken }
 * Header: Authorization: Bearer <accessToken>
 */
async function logout(req, res, next) {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await refreshTokenService.revokeRefreshToken(refreshToken);
    }
    logger.info('User logged out', { userId: req.user?.id });
    return res.status(200).json({ success: true, message: 'Logged out successfully.' });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /auth/logout-all
 * Header: Authorization: Bearer <accessToken>
 * Revoke ALL refresh tokens for the authenticated user.
 */
async function logoutAll(req, res, next) {
  try {
    await refreshTokenService.revokeAllUserRefreshTokens(req.user.id);
    logger.info('User logged out from all devices', { userId: req.user.id });
    return res.status(200).json({ success: true, message: 'Logged out from all devices.' });
  } catch (err) {
    next(err);
  }
}

// ─── Resend OTP ───────────────────────────────────────────────────────────────

async function resendOtp(req, res, next) {
  try {
    handleValidationErrors(req);
    const { userId } = req.body;

    const user = await userService.findUserById(userId);
    if (!user) throw new AppError('User not found.', 404);
    if (user.is_verified) throw new AppError('Email is already verified.', 400);

    const otp = await otpService.createOtp(user.id, user.email);
    await emailService.sendOtpEmail(user.email, otp);

    logger.info('OTP resent', { userId });

    return res.status(200).json({
      success: true,
      message: 'A new verification code has been sent to your email.',
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { signup, verifyOtp, login, refreshTokens, logout, logoutAll, resendOtp };
