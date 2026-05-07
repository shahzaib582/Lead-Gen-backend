const { google } = require('googleapis');
const supabase = require('../config/supabase');

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

async function getValidGoogleAccessToken(userId) {
  const { data: account, error } =
    await supabase
      .from('google_accounts')
      .select('*')
      .eq('user_id', userId)
      .single();

  if (error || !account) {
    throw new Error(
      'Google account not connected'
    );
  }

  const {
    google_access_token,
    google_refresh_token,
    token_expires_at,
  } = account;

  const expiresAt =
    token_expires_at
      ? new Date(
          token_expires_at
        ).getTime()
      : 0;

  const isExpired =
    !expiresAt ||
    Date.now() >= expiresAt - 60000;

  // Current token valid
  if (!isExpired) {
    return google_access_token;
  }

  // Refresh token missing
  if (!google_refresh_token) {
    throw new Error(
      'Refresh token missing'
    );
  }

  oauth2Client.setCredentials({
    refresh_token:
      google_refresh_token,
  });

  const { credentials } =
    await oauth2Client.refreshAccessToken();

  if (!credentials.access_token) {
    throw new Error(
      'Failed to refresh token'
    );
  }

  await supabase
    .from('google_accounts')
    .update({
      google_access_token:
        credentials.access_token,

      token_expires_at:
        credentials.expiry_date
          ? new Date(
              credentials.expiry_date
            ).toISOString()
          : null,
    })
    .eq('user_id', userId);

  return credentials.access_token;
}

module.exports = {
  getValidGoogleAccessToken,
};