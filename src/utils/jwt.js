const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const AppError = require('./AppError');

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET;

const ACCESS_EXPIRES = process.env.JWT_ACCESS_EXPIRES_IN || '15m';

if (!ACCESS_SECRET || ACCESS_SECRET.length < 32) {
  throw new Error('JWT_ACCESS_SECRET or JWT_SECRET must be set and at least 32 characters long.');
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
    if (decoded.type !== 'access') {
      throw new AppError('Invalid access token.', 401, 'INVALID_ACCESS_TOKEN');
    }
    return decoded;
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err.name === 'TokenExpiredError') {
      throw new AppError('Access token expired. Please login again.', 401, 'TOKEN_EXPIRED');
    }
    throw new AppError('Invalid access token.', 401, 'INVALID_ACCESS_TOKEN');
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
