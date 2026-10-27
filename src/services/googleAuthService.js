const { google } = require('googleapis');
const supabase = require('../config/supabase');
const userService = require('./userService');
const { accountHasCalendarScope } = require('../utils/googleCalendarScopes');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

function parseScopes(scope) {
  if (!scope) return [];
  if (Array.isArray(scope)) return scope;
  return String(scope)
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildGoogleAccountRow(userId, { email, name, avatarUrl, googleTokens, googleId }) {
  return {
    user_id: userId,
    google_id: googleId,
    email: email.toLowerCase().trim(),
    name: name || null,
    avatar_url: avatarUrl || null,
    google_access_token: googleTokens.access_token,
    google_refresh_token: googleTokens.refresh_token || null,
    token_expires_at: googleTokens.expiry_date
      ? new Date(googleTokens.expiry_date).toISOString()
      : null,
    scopes: parseScopes(googleTokens.scope),
  };
}

async function findGoogleAccountByEmail(email) {
  const { data, error } = await supabase
    .from('google_accounts')
    .select('*, users(*)')
    .eq('email', email.toLowerCase().trim())
    .maybeSingle();

  if (error) throw new AppError('Database error', 500);
  return data;
}

async function findGoogleAccountByUserId(userId) {
  const { data, error } = await supabase
    .from('google_accounts')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw new AppError('Database error', 500);
  return data;
}

async function upsertGoogleAccount(userId, { email, name, avatarUrl, googleTokens, googleId }) {
  const row = buildGoogleAccountRow(userId, { email, name, avatarUrl, googleTokens, googleId });

  const { error } = await supabase.from('google_accounts').upsert(row, { onConflict: 'user_id' });

  if (error) {
    logger.error('[google_accounts] upsert failed', { userId, message: error.message });
    throw new AppError('Failed to save Google account.', 500);
  }
}

/** Google has already verified the email; ensure our users row reflects that. */
async function ensureGoogleEmailVerified(user) {
  if (!user || user.is_verified) return user;
  await userService.markUserVerified(user.id);
  return { ...user, is_verified: true };
}

async function createGoogleUser({ email, name, avatarUrl, googleTokens, googleId }) {
  await userService.assertEmailAvailableForSignup(email);

  const safeName = name ? String(name).trim().slice(0, 200) : null;
  const safePic = avatarUrl ? String(avatarUrl).trim().slice(0, 2048) : null;

  const { data: user, error: userError } = await supabase
    .from('users')
    .insert({
      email: email.toLowerCase().trim(),
      auth_provider: 'google',
      is_verified: true,
      name: safeName || null,
      profile_pic: safePic || null,
    })
    .select()
    .single();

  if (userError) {
    if (userError.code === '23505') {
      throw new AppError('An account with this email already exists.', 409);
    }
    throw new AppError('Failed to create user.', 500);
  }

  await upsertGoogleAccount(user.id, { email, name, avatarUrl, googleTokens, googleId });

  const { bootstrapUserBilling } = require('./stripeCustomerService');
  void bootstrapUserBilling(user.id, user.email);

  return user;
}

/**
 * Find or create a user from a verified Google profile and persist OAuth tokens.
 */
async function resolveUserFromGoogleProfile({ email, name, avatarUrl, googleTokens, googleId }) {
  if (!googleId) {
    throw new AppError('Google user id (sub) is required.', 400);
  }

  const existingGoogleAccount = await findGoogleAccountByEmail(email);

  if (existingGoogleAccount) {
    const user = existingGoogleAccount.users;
    userService.assertUserActive(user);
    await upsertGoogleAccount(user.id, { email, name, avatarUrl, googleTokens, googleId });
    return ensureGoogleEmailVerified(user);
  }

  const existingUser = await userService.findUserByEmail(email);

  if (!existingUser) {
    const closed = await userService.findUserByEmailIncludingDeleted(email);
    if (closed && userService.isUserDeleted(closed)) {
      userService.assertUserActive(closed);
    }
  }

  if (existingUser) {
    if (existingUser.auth_provider === 'email') {
      await upsertGoogleAccount(existingUser.id, {
        email,
        name,
        avatarUrl,
        googleTokens,
        googleId,
      });
      await userService.updateAuthProvider(existingUser.id, 'google');
      return ensureGoogleEmailVerified(existingUser);
    }

    if (existingUser.auth_provider === 'google') {
      await upsertGoogleAccount(existingUser.id, {
        email,
        name,
        avatarUrl,
        googleTokens,
        googleId,
      });
      return ensureGoogleEmailVerified(existingUser);
    }

    throw new AppError('This email is already registered with a different provider.', 409);
  }

  return createGoogleUser({ email, name, avatarUrl, googleTokens, googleId });
}

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

  if (!isExpired) {
    return google_access_token;
  }

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
    throw new AppError(
      'Google token refresh returned no access token.',
      401,
      'GOOGLE_REFRESH_FAILED'
    );
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

const TOKEN_EXPIRY_BUFFER_MS = 60_000;

function isAccessTokenFresh(tokenExpiresAt, nowMs = Date.now()) {
  if (!tokenExpiresAt) return false;
  const expiresAt = new Date(tokenExpiresAt).getTime();
  return Number.isFinite(expiresAt) && nowMs < expiresAt - TOKEN_EXPIRY_BUFFER_MS;
}

/**
 * Returns a cached Google access token only when still fresh — no OAuth refresh (fast).
 * Use in auth middleware; callers that send mail/calendar should use getValidGoogleAccessToken.
 */
async function peekGoogleAccessToken(userId) {
  const account = await findGoogleAccountByUserId(userId);
  if (!account?.google_access_token) return null;
  if (!isAccessTokenFresh(account.token_expires_at)) return null;
  return account.google_access_token;
}

/**
 * Whether Google APIs can be used for this user (fresh access token or successful refresh).
 * Updates stored tokens when a refresh succeeds.
 */
async function getGoogleAccountStatus(userId) {
  const account = await findGoogleAccountByUserId(userId);
  if (!account) {
    return {
      linked: false,
      calendarLinked: false,
      tokenExpired: false,
      needsReconnect: false,
    };
  }

  let tokenExpiresAt = account.token_expires_at;
  let linked = isAccessTokenFresh(tokenExpiresAt);

  if (!linked && account.google_refresh_token) {
    try {
      await getValidGoogleAccessToken(userId);
      const refreshed = await findGoogleAccountByUserId(userId);
      tokenExpiresAt = refreshed?.token_expires_at ?? tokenExpiresAt;
      linked = isAccessTokenFresh(tokenExpiresAt);
    } catch (err) {
      logger.warn('[google] status refresh failed', {
        userId,
        message: err.message,
        code: err.code,
      });
      linked = false;
    }
  }

  const needsReconnect = !linked;

  return {
    linked,
    calendarLinked: linked && accountHasCalendarScope(account.scopes),
    tokenExpired: needsReconnect,
    needsReconnect,
    email: account.email,
    name: account.name,
    avatarUrl: account.avatar_url,
    scopes: account.scopes,
    tokenExpiresAt,
  };
}

module.exports = {
  getValidGoogleAccessToken,
  peekGoogleAccessToken,
  getGoogleAccountStatus,
  isAccessTokenFresh,
  findGoogleAccountByEmail,
  findGoogleAccountByUserId,
  upsertGoogleAccount,
  createGoogleUser,
  resolveUserFromGoogleProfile,
};
