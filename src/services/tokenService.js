// Unified token service — re-exports everything from jwt utils for convenience.
const {
  generateAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  signToken,
  verifyToken,
} = require('../utils/jwt');

module.exports = {
  generateAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  // legacy aliases used by authController
  signToken,
  verifyToken,
};
