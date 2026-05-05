const supabase   = require('../config/supabase');
const AppError   = require('../utils/AppError');
const logger     = require('../utils/logger');


async function findGoogleAccountByEmail(email) {
  const { data, error } = await supabase
    .from('google_accounts')
    .select('*, users(*)')
    .eq('email', email.toLowerCase().trim())
    .maybeSingle();

  if (error) throw new AppError('Database error.', 500);
  return data;
}


async function findGoogleAccountByUserId(userId) {
  const { data, error } = await supabase
    .from('google_accounts')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw new AppError('Database error.', 500);
  return data;
}

/**
 * Create a new user + google_account row in one transaction-like sequence.
 * Used when a Google user signs up for the first time.
 */
async function createGoogleUser({ email, name, avatarUrl, googleTokens }) {
  // 1. Insert user row (no password — Google auth only)
  const { data: user, error: userError } = await supabase
    .from('users')
    .insert({
      email:         email.toLowerCase().trim(),
      password_hash: null,
      is_verified:   true,          // Google emails are pre-verified
      auth_provider: 'google',
    })
    .select()
    .single();

  if (userError) {
    logger.error('Supabase insert user failed', { error: userError, email });
    if (userError.code === '23505') {
      throw new AppError('An account with this email already exists. Please log in with email/password or link your Google account.', 409);
    }
    throw new AppError(
      process.env.NODE_ENV === 'production'
        ? 'Failed to create user.'
        : `Failed to create user. Supabase error: ${userError.message}`,
      500
    );
  }

  // 2. Insert google_accounts row
  await upsertGoogleAccount(user.id, { email, name, avatarUrl, googleTokens });

  return user;
}

/**
 * Upsert (insert or update) the google_accounts row for a user.
 * Called both on first login and on subsequent logins to keep tokens fresh.
 */
async function upsertGoogleAccount(userId, {email, name, avatarUrl, googleTokens }) {
  const tokenExpiresAt = googleTokens.expiry_date
    ? new Date(googleTokens.expiry_date).toISOString()
    : null;

  const payload = {
    user_id:              userId,
    email:                email.toLowerCase().trim(),
    name:                 name   || null,
    avatar_url:           avatarUrl || null,
    google_access_token:  googleTokens.access_token,
    token_expires_at:     tokenExpiresAt,
    scopes:               googleTokens.scope ? googleTokens.scope.split(' ') : [],
  };

  // Only update refresh token if Google returned one (it only does on first consent)
  if (googleTokens.refresh_token) {
    payload.google_refresh_token = googleTokens.refresh_token;
  }

  const { error } = await supabase
    .from('google_accounts')
    .upsert(payload, { onConflict: 'user_id' });

  if (error) {
    logger.error('Supabase upsert google account failed', { error, payload });
    throw new AppError(
      process.env.NODE_ENV === 'production'
        ? 'Failed to save Google account.'
        : `Failed to save Google account. Supabase error: ${error.message}`,
      500
    );
  }
}

/**
 * Refresh the Google access token using the stored refresh token.
 * Updates the DB record with the new access token.
 */
async function refreshGoogleAccessToken(userId) {
  const { createOAuthClient } = require('../config/googleOAuth');

  const account = await findGoogleAccountByUserId(userId);
  if (!account)                       throw new AppError('No linked Google account found.', 404);
  if (!account.google_refresh_token)  throw new AppError('No Google refresh token stored. User must re-authorize.', 401);

  const client = createOAuthClient();
  client.setCredentials({ refresh_token: account.google_refresh_token });

  const { credentials } = await client.refreshAccessToken();

  // Persist updated access token
  const { error } = await supabase
    .from('google_accounts')
    .update({
      google_access_token: credentials.access_token,
      token_expires_at:    credentials.expiry_date
        ? new Date(credentials.expiry_date).toISOString()
        : null,
    })
    .eq('user_id', userId);

  if (error) throw new AppError('Failed to update Google access token.', 500);

  return credentials.access_token;
}

/**
 * Return a fresh, valid Google access token — refreshing automatically if expired.
 */
async function getValidGoogleAccessToken(userId) {
  const account = await findGoogleAccountByUserId(userId);
  if (!account) throw new AppError('No linked Google account found.', 404);

  const isExpired = account.token_expires_at
    ? new Date(account.token_expires_at) <= new Date(Date.now() + 60_000) // 1-min buffer
    : false;

  if (isExpired) {
    return refreshGoogleAccessToken(userId);
  }

  return account.google_access_token;
}

module.exports = {
  findGoogleAccountByEmail,
  findGoogleAccountByUserId,
  createGoogleUser,
  upsertGoogleAccount,
  refreshGoogleAccessToken,
  getValidGoogleAccessToken,
};
