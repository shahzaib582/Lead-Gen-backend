const { generateAccessToken, generateRefreshToken } = require('../utils/jwt');
const refreshTokenService = require('./refreshTokenService');

/**
 * Issue a fresh access + refresh token pair and persist the refresh token.
 * @param {{ id: string }} user
 */
async function issueTokenPair(user) {
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken();
  await refreshTokenService.saveRefreshToken(user.id, refreshToken);
  return { accessToken, refreshToken };
}

module.exports = { issueTokenPair };
