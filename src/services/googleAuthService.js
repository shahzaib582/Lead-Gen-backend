const { google } = require('googleapis');
const supabase = require('../config/supabase');
const AppError = require('../utils/AppError');

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

async function getValidGoogleAccessToken(userId) {
  const { data: account, error } = await supabase
    .from('google_accounts')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error || !account) {
    throw new AppError('Google account not connected.', 401, 'GOOGLE_NOT_LINKED');
  }

  const { google_access_token, google_refresh_token, token_expires_at } = account;

  const expiresAt = token_expires_at ? new Date(token_expires_at).getTime() : 0;

  const isExpired = !expiresAt || Date.now() >= expiresAt - 60000;

  // Current token valid
  if (!isExpired) {
    return google_access_token;
  }

  // Refresh token missing
  if (!google_refresh_token) {
    throw new AppError(
      'Google refresh token missing; reconnect Gmail (GET /api/auth/google).',
      401,
      'GOOGLE_REFRESH_MISSING'
    );
  }

  oauth2Client.setCredentials({
    refresh_token: google_refresh_token,
  });

  let credentials;
  try {
    ({ credentials } = await oauth2Client.refreshAccessToken());
  } catch (err) {
    throw new AppError(
      `Google token refresh failed: ${err.message || 'unknown error'}`,
      401,
      'GOOGLE_REFRESH_FAILED'
    );
  }

  if (!credentials.access_token) {
    throw new AppError('Google token refresh returned no access token.', 401, 'GOOGLE_REFRESH_FAILED');
  }

  await supabase
    .from('google_accounts')
    .update({
      google_access_token: credentials.access_token,

      token_expires_at: credentials.expiry_date
        ? new Date(credentials.expiry_date).toISOString()
        : null,
    })
    .eq('user_id', userId);

  return credentials.access_token;
}

module.exports = {
  getValidGoogleAccessToken,
};
