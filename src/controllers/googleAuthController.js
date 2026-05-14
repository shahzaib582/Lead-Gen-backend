const { getAuthUrl, exchangeCodeForProfile } = require('../config/googleOAuth');
const googleAuthService = require('../services/googleAuthService');
const refreshTokenService = require('../services/refreshTokenService');
const userService = require('../services/userService');
const { generateAccessToken, generateRefreshToken } = require('../utils/jwt');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { successResponse } = require('../utils/response');

// ─── Helper: issue our own access + refresh token pair ───────────────────────

async function issueTokenPair(user) {
  const accessToken = generateAccessToken(user);
  const rawRefresh = generateRefreshToken();
  await refreshTokenService.saveRefreshToken(user.id, rawRefresh);
  return { accessToken, refreshToken: rawRefresh };
}

// ─── GET /auth/google ─────────────────────────────────────────────────────────
// Redirect the user to Google's consent screen.
// Query `?format=json` returns JSON { authUrl } for API clients / Swagger (browser redirect is not fetch-safe).

function redirectToGoogle(req, res) {
  const url = getAuthUrl();
  if (req.query.format === 'json') {
    return successResponse(res, 200, undefined, { authUrl: url });
  }
  res.redirect(url);
}

// ─── GET /auth/google/callback ────────────────────────────────────────────────
// Google redirects back here with ?code=... after the user consents.

async function handleGoogleCallback(req, res, next) {
  try {
    const { code, error: oauthError } = req.query;

    if (oauthError) {
      throw new AppError(`Google OAuth error: ${oauthError}`, 400);
    }
    if (!code) {
      throw new AppError('Authorization code missing from Google callback.', 400);
    }

    // 1. Exchange code for Google tokens + profile
    const { googleTokens, profile } = await exchangeCodeForProfile(code);
    const { email, name, picture: avatarUrl, verified_email } = profile;

    if (!verified_email) {
      throw new AppError('Google account email is not verified.', 400);
    }

    // 2. Check if this Google account is already linked
    let existingGoogleAccount = await googleAuthService.findGoogleAccountByEmail(email);

    let user;

    if (existingGoogleAccount) {
      // Returning Google user — update tokens (access token rotates, refresh token only if re-consented)
      user = existingGoogleAccount.users;
      await googleAuthService.upsertGoogleAccount(user.id, {
        email,
        name,
        avatarUrl,
        googleTokens,
      });
      logger.info('Google user logged in', { userId: user.id, email });
    } else {
      // Check if a local account exists with same email
      const existingUser = await userService.findUserByEmail(email);

      if (existingUser) {
        if (existingUser.auth_provider === 'email') {
          // Email account exists — link Google to it
          await googleAuthService.upsertGoogleAccount(existingUser.id, {
            email,
            name,
            avatarUrl,
            googleTokens,
          });
          // Upgrade provider to google
          user = existingUser;
          logger.info('Google account linked to existing email user', { userId: user.id });
        } else {
          throw new AppError('This email is already registered with a different provider.', 409);
        }
      } else {
        // Brand-new user — create account
        user = await googleAuthService.createGoogleUser({
          email,
          name,
          avatarUrl,
          googleTokens,
        });
        logger.info('New user registered via Google', { userId: user.id, email });
      }
    }

    // 3. Issue our own JWT access + refresh token pair
    const { accessToken, refreshToken } = await issueTokenPair(user);

    // 4. Respond — for a pure API, return JSON; for a web app, redirect with tokens
    // JSON response (suitable for mobile / SPA clients)
    return successResponse(res, 200, 'Google authentication successful.', {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name,
        avatarUrl,
        authProvider: 'google',
      },
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /auth/google/token ───────────────────────────────────────────────────
// Mobile / SPA flow: client already has a Google ID token — exchange it directly.

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
    const { email, name, picture: avatarUrl, email_verified: emailVerified } = payload;

    if (!emailVerified) {
      throw new AppError('Google account email is not verified.', 400);
    }

    // Same upsert logic as the callback handler
    let existingGoogleAccount = await googleAuthService.findGoogleAccountByEmail(email);
    let user;

    const googleTokens = {
      access_token: id_token, // store id_token as access token for token-based flow
      refresh_token: null, // no refresh token in ID-token flow
      expiry_date: payload.exp * 1000,
      scope: 'openid email profile',
    };

    if (existingGoogleAccount) {
      user = existingGoogleAccount.users;
      await googleAuthService.upsertGoogleAccount(user.id, {
        email,
        name,
        avatarUrl,
        googleTokens,
      });
    } else {
      const existingUser = await userService.findUserByEmail(email);
      if (existingUser) {
        await googleAuthService.upsertGoogleAccount(existingUser.id, {
          email,
          name,
          avatarUrl,
          googleTokens,
        });
        user = existingUser;
      } else {
        user = await googleAuthService.createGoogleUser({
          email,
          name,
          avatarUrl,
          googleTokens,
        });
      }
    }

    const { accessToken, refreshToken } = await issueTokenPair(user);

    logger.info('Google token login', { userId: user.id });

    return successResponse(res, 200, 'Google authentication successful.', {
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, name, avatarUrl, authProvider: 'google' },
    });
  } catch (err) {
    if (err.message && err.message.includes('Token used too late')) {
      return next(new AppError('Google ID token has expired.', 401));
    }
    next(err);
  }
}

// ─── GET /auth/google/status ──────────────────────────────────────────────────
// Check if the authenticated user has a linked Google account + granted scopes.

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
