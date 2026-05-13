const { google } = require('googleapis');

/**
 * Create and return a configured OAuth2 client.
 * A new instance is created per request so state is never shared.
 */
function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI // e.g. http://localhost:3000/api/auth/google/callback
  );
}

/**
 * Scopes requested from Google:
 *  - openid         → identity (sub / user ID)
 *  - email          → email address + verified status
 *  - profile        → display name, avatar
 *  - gmail.send     → send emails on behalf of the user (mail permission)
 *  - gmail.readonly → read inbox / labels (optional — remove if not needed)
 */
const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
];

/**
 * Build the Google OAuth consent-screen URL.
 * access_type=offline  → returns a Google refresh token
 * prompt=consent       → forces consent screen every time so refresh token is always returned
 */
function getAuthUrl(state = '') {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: GOOGLE_SCOPES,
    state,
  });
}

/**
 * Exchange the authorization code for Google tokens and fetch the user profile.
 * Returns { googleTokens, profile }
 */
async function exchangeCodeForProfile(code) {
  const client = createOAuthClient();

  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  // Fetch Google profile using the People API
  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const { data: profile } = await oauth2.userinfo.get();

  return { googleTokens: tokens, profile };
}

module.exports = { createOAuthClient, getAuthUrl, exchangeCodeForProfile, GOOGLE_SCOPES };
