const { verifyAccessToken } = require('../utils/jwt');
const userService = require('../services/userService');
const googleAuthService = require('../services/googleAuthService');
const { toPublicUser } = require('../utils/userPublic');
const AppError = require('../utils/AppError');

/**
 * Middleware — verify Bearer access token and attach user to req.user.
 * Also attaches a cached googleAccessToken when the stored Google token is still fresh
 * (no OAuth refresh on every request — mail/calendar routes refresh on demand).
 *
 * Usage: router.get('/protected', authenticate, handler)
 */
async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError('No token provided. Authorization required.', 401);
    }

    const token = authHeader.slice(7);
    const decoded = verifyAccessToken(token); // throws AppError 401 (e.g. TOKEN_EXPIRED)

    const user = await userService.findUserById(decoded.sub);
    if (!user) throw new AppError('User no longer exists.', 401);
    userService.assertUserActive(user);
    if (!user.is_verified) throw new AppError('Email not verified.', 403);

    const publicUser = toPublicUser(user);
    req.user = {
      ...publicUser,
      googleAccessToken: null,
    };

    // Attach cached Google token only when still fresh — never refresh here (avoids multi-second
    // OAuth calls on unrelated routes like PATCH /api/user password change).
    try {
      const googleToken = await googleAuthService.peekGoogleAccessToken(user.id);
      if (googleToken) {
        req.user.googleAccessToken = googleToken;
      }
    } catch {
      // No Google account linked — that's fine, req.user.googleAccessToken stays null
    }

    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { authenticate };
