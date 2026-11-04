const { getAuthUrl, exchangeCodeForProfile } = require('../config/googleOAuth');
const googleAuthService = require('../services/googleAuthService');
const userService = require('../services/userService');
const { issueTokenPair } = require('../services/authTokenService');
const AppError = require('../utils/AppError');
const { successResponse } = require('../utils/response');
const { createOAuthState, consumeOAuthState } = require('../services/googleOAuthStateService');
const { toPublicUser } = require('../utils/userPublic');

async function redirectToGoogle(req, res, next) {
  try {
    const state = await createOAuthState(res);
    const url = getAuthUrl(state);
    if (req.query.format === 'json') {
      return successResponse(res, 200, undefined, { authUrl: url });
    }
    res.redirect(url);
  } catch (err) {
    next(err);
  }
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

    await consumeOAuthState(req, res);
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
    const {
      email,
      name,
      picture: avatarUrl,
      email_verified: emailVerified,
      sub: googleId,
    } = payload;

    if (!emailVerified) {
      throw new AppError('Google account email is not verified.', 400);
    }

    // Identity login must never replace the Gmail OAuth grant.
    const googleTokens = null;

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
    if (err.message && err.message.includes('Token used too late')) {
      return next(new AppError('Google ID token has expired.', 401));
    }
    next(err);
  }
}

async function getGoogleStatus(req, res, next) {
  try {
    const status = await googleAuthService.getGoogleAccountStatus(req.user.id);
    return successResponse(res, 200, undefined, status);
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
