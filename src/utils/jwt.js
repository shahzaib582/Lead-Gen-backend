const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET;

const ACCESS_EXPIRES = process.env.JWT_ACCESS_EXPIRES_IN || '15m';

if (!ACCESS_SECRET || ACCESS_SECRET.length < 32) {
  throw new Error('JWT_ACCESS_SECRET must be set and at least 32 characters long.');
}

// ─── Access Token ─────────────────────────────────────────────────────────────

function generateAccessToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, type: 'access' }, ACCESS_SECRET, {
    expiresIn: ACCESS_EXPIRES,
    algorithm: 'HS256',
  });
}

function verifyAccessToken(token) {
  try {
    const decoded = jwt.verify(token, ACCESS_SECRET, { algorithms: ['HS256'] });
    if (decoded.type !== 'access') throw new Error('Wrong token type');
    return decoded;
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      const e = new Error('Access token expired.');
      e.statusCode = 401;
      e.code = 'TOKEN_EXPIRED';
      throw e;
    }
    const e = new Error('Invalid access token.');
    e.statusCode = 401;
    throw e;
  }
}

// ─── Refresh Token ────────────────────────────────────────────────────────────

function generateRefreshToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashRefreshToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function refreshTokenExpiry() {
  const days = parseInt(process.env.JWT_REFRESH_EXPIRES_DAYS || '7', 10);
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

// ─── Legacy compatibility ────────────────────────────────────────────────────

function signToken(user) {
  return generateAccessToken(user);
}

function verifyToken(token) {
  return verifyAccessToken(token);
}

module.exports = {
  generateAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  signToken,
  verifyToken,
};
