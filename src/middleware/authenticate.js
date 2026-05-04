const { verifyAccessToken } = require('../utils/jwt');
const userService = require('../services/userService');
const AppError    = require('../utils/AppError');

/**
 * Middleware — verify Bearer access token and attach user to req.user.
 * Usage: router.get('/protected', authenticate, handler)
 */
async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError('No token provided. Authorization required.', 401);
    }

    const token   = authHeader.slice(7);
    const decoded = verifyAccessToken(token);   // throws with code TOKEN_EXPIRED if expired

    const user = await userService.findUserById(decoded.sub);
    if (!user)            throw new AppError('User no longer exists.', 401);
    if (!user.is_verified) throw new AppError('Email not verified.', 403);

    req.user = {
      id:         user.id,
      email:      user.email,
      isVerified: user.is_verified,
    };

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
