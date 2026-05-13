const { verifyAccessToken } = require('../utils/jwt');
const userService = require('../services/userService');
const googleAuthService = require('../services/googleAuthService');
const AppError = require('../utils/AppError');

/**
 * Middleware — verify Bearer access token and attach user to req.user.
 * Also silently attaches googleAccessToken if the user has a linked Google account,
 * so controllers can use req.user.googleAccessToken without a separate DB call.
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
    const decoded = verifyAccessToken(token); // throws with code TOKEN_EXPIRED if expired

    const user = await userService.findUserById(decoded.sub);
    if (!user) throw new AppError('User no longer exists.', 401);
    if (!user.is_verified) throw new AppError('Email not verified.', 403);

    req.user = {
      id: user.id,
      email: user.email,
      isVerified: user.is_verified,
      googleAccessToken: null, // default — populated below if linked
    };

    // Silently attach Google access token if the user has linked their Google account.
    // This works for BOTH email/password users and Google-login users.
    // We catch all errors so a missing/expired Google account never blocks authentication.
    try {
      const googleToken = await googleAuthService.getValidGoogleAccessToken(user.id);
      if (googleToken) {
        req.user.googleAccessToken = googleToken;
      }
    } catch {
      // No Google account linked — that's fine, req.user.googleAccessToken stays null
    }

    next();
  } catch (err) {
    // Pass token-expired errors with a helpful hint for the client
    if (err.code === 'TOKEN_EXPIRED') {
      err.message = 'Access token expired. Use /auth/refresh to get a new one.';
      err.statusCode = 401;
    }
    next(err);
  }
}

module.exports = { authenticate };
