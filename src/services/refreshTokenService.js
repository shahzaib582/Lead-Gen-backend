const supabase  = require('../config/supabase');
const { hashRefreshToken, refreshTokenExpiry } = require('../utils/jwt');
const AppError  = require('../utils/AppError');

/**
 * Persist a new refresh token in the database.
 * @param {string} userId   - User UUID
 * @param {string} rawToken - Plain refresh token (client receives this)
 */
async function saveRefreshToken(userId, rawToken) {
  const tokenHash = hashRefreshToken(rawToken);
  const expiresAt = refreshTokenExpiry();

  const { error } = await supabase
    .from('refresh_tokens')
    .insert({ user_id: userId, token_hash: tokenHash, expires_at: expiresAt });

  if (error) throw new AppError('Failed to save refresh token.', 500);
}

/**
 * Verify an incoming refresh token and return the DB record.
 * Throws on invalid / expired / revoked token.
 */
async function validateRefreshToken(rawToken) {
  const tokenHash = hashRefreshToken(rawToken);

  const { data, error } = await supabase
    .from('refresh_tokens')
    .select('*')
    .eq('token_hash', tokenHash)
    .single();

  if (error || !data) throw new AppError('Invalid refresh token.', 401);
  if (data.revoked)   throw new AppError('Refresh token has been revoked.', 401);
  if (new Date(data.expires_at) < new Date()) {
    throw new AppError('Refresh token has expired. Please log in again.', 401);
  }

  return data;
}

/**
 * Revoke a single refresh token (logout from one device).
 */
async function revokeRefreshToken(rawToken) {
  const tokenHash = hashRefreshToken(rawToken);

  const { error } = await supabase
    .from('refresh_tokens')
    .update({ revoked: true })
    .eq('token_hash', tokenHash);

  if (error) throw new AppError('Failed to revoke token.', 500);
}

/**
 * Revoke ALL refresh tokens for a user (logout from all devices).
 */
async function revokeAllUserRefreshTokens(userId) {
  const { error } = await supabase
    .from('refresh_tokens')
    .update({ revoked: true })
    .eq('user_id', userId)
    .eq('revoked', false);

  if (error) throw new AppError('Failed to revoke all sessions.', 500);
}

/**
 * Delete a specific refresh token record (used during token rotation).
 */
async function deleteRefreshToken(id) {
  await supabase.from('refresh_tokens').delete().eq('id', id);
}

module.exports = {
  saveRefreshToken,
  validateRefreshToken,
  revokeRefreshToken,
  revokeAllUserRefreshTokens,
  deleteRefreshToken,
};
