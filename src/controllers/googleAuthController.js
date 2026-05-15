const { getAuthUrl, exchangeCodeForProfile } = require('../config/googleOAuth');
const googleAuthService = require('../services/googleAuthService');
const userService = require('../services/userService');
const { issueTokenPair } = require('../services/authTokenService');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { successResponse } = require('../utils/response');
const { toPublicUser } = require('../utils/userPublic');

function redirectToGoogle(req, res) {
  const url = getAuthUrl();
  if (req.query.format === 'json') {
    return successResponse(res, 200, undefined, { authUrl: url });
  }
  res.redirect(url);
}

async function handleGoogleCallback(req, res, next) {
  try {
    const { code, error: oauthError } = req.query;

    if (oauthError) {
      throw new AppError(`Google OAuth error: ${oauthError}`, 400);
    }
    if (!code) {
      throw new AppError('Authorization code missing from Google callback.', 400);
    }

    const { googleTokens, profile } = await exchangeCodeForProfile(code);
    const { email, name, picture: avatarUrl, verified_email } = profile;

    if (!verified_email) {
      throw new AppError('Google account email is not verified.', 400);
    }

    const googleId = profile.sub || profile.id;
    const user = await googleAuthService.resolveUserFromGoogleProfile({
      email,
      name,
      avatarUrl,
      googleTokens,
      googleId,
    });

    const fresh = await userService.findUserById(user.id);
    const { accessToken, refreshToken } = await issueTokenPair(fresh);

    return successResponse(res, 200, 'Google authentication successful.', {
      accessToken,
      refreshToken,
      user: { ...toPublicUser(fresh), authProvider: 'google' },
    });
  } catch (err) {
    next(err);
  }
}

async function loginWithGoogleToken(req, res, next) {
  try {
    const { id_token } = req.body;
    if (!id_token) throw new AppError('Google ID token is required.', 400);

    const { OAuth2Client } = require('google-auth-library');
    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

    const ticket = await client.verifyIdToken({
      idToken: id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { email, name, picture: avatarUrl, email_verified: emailVerified, sub: googleId } =
      payload;

    if (!emailVerified) {
      throw new AppError('Google account email is not verified.', 400);
    }

    const googleTokens = {
      access_token: id_token,
      refresh_token: null,
      expiry_date: payload.exp * 1000,
      scope: 'openid email profile',
    };

    const user = await googleAuthService.resolveUserFromGoogleProfile({
      email,
      name,
      avatarUrl,
      googleTokens,
      googleId,
    });

    const fresh = await userService.findUserById(user.id);
    const { accessToken, refreshToken } = await issueTokenPair(fresh);

    logger.info('Google token login', { userId: user.id });

    return successResponse(res, 200, 'Google authentication successful.', {
      accessToken,
      refreshToken,
      user: { ...toPublicUser(fresh), authProvider: 'google' },
    });
  } catch (err) {
    if (err.message && err.message.includes('Token used too late')) {
      return next(new AppError('Google ID token has expired.', 401));
    }
    next(err);
  }
}

async function getGoogleStatus(req, res, next) {
  try {
    const account = await googleAuthService.findGoogleAccountByUserId(req.user.id);
    if (!account) {
      return successResponse(res, 200, undefined, { linked: false });
    }

    return successResponse(res, 200, undefined, {
      linked: true,
      email: account.email,
      name: account.name,
      avatarUrl: account.avatar_url,
      scopes: account.scopes,
      tokenExpiresAt: account.token_expires_at,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  redirectToGoogle,
  handleGoogleCallback,
  loginWithGoogleToken,
  getGoogleStatus,
};
