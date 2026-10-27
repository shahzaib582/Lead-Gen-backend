const supabase = require('../config/supabase');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { isValidCalendlyUrl, normalizeCalendlyUrl } = require('../utils/calendlyUrl');
const {
  assertCalendlyOAuthConfig,
  generatePkcePair,
  createConnectState,
  verifyConnectState,
  getAuthorizeUrl,
  getPublicWebhookUrl,
} = require('../config/calendlyOAuth');
const {
  exchangeAuthorizationCode,
  refreshAccessToken,
  getCurrentUser,
  createWebhookSubscription,
  deleteWebhookSubscription,
} = require('./calendlyApiClient');

const WEBHOOK_EVENTS = ['invitee.created', 'invitee.canceled'];

function tokenExpiresAt(expiresInSeconds) {
  if (!expiresInSeconds) return null;
  return new Date(Date.now() + Number(expiresInSeconds) * 1000).toISOString();
}

function isTokenExpired(account) {
  if (!account?.token_expires_at) return true;
  const bufferMs = 60 * 1000;
  return new Date(account.token_expires_at).getTime() - bufferMs <= Date.now();
}

async function findCalendlyAccountByUserId(userId) {
  const { data, error } = await supabase
    .from('calendly_accounts')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw new AppError('Failed to load Calendly account.', 500);
  return data;
}

async function persistTokens(userId, tokenData) {
  const patch = {
    access_token: tokenData.access_token,
    token_expires_at: tokenExpiresAt(tokenData.expires_in),
  };
  if (tokenData.refresh_token) {
    patch.refresh_token = tokenData.refresh_token;
  }

  const { data, error } = await supabase
    .from('calendly_accounts')
    .update(patch)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) throw new AppError('Failed to update Calendly tokens.', 500);
  return data;
}

async function getValidAccessToken(userId) {
  const account = await findCalendlyAccountByUserId(userId);
  if (!account) {
    throw new AppError('Calendly is not connected.', 400, 'CALENDLY_NOT_LINKED');
  }

  if (!isTokenExpired(account)) {
    return account.access_token;
  }

  if (!account.refresh_token) {
    throw new AppError('Calendly connection expired. Reconnect Calendly.', 401, 'CALENDLY_TOKEN_EXPIRED');
  }

  try {
    const refreshed = await refreshAccessToken(account.refresh_token);
    const updated = await persistTokens(userId, refreshed);
    return updated.access_token;
  } catch (err) {
    logger.warn('[CalendlyAuth] Token refresh failed', { userId, error: err.message });
    throw new AppError('Calendly connection expired. Reconnect Calendly.', 401, 'CALENDLY_TOKEN_EXPIRED');
  }
}

async function deleteExistingWebhook(account) {
  if (!account?.webhook_subscription_uri) return;

  try {
    const token = await getValidAccessToken(account.user_id);
    await deleteWebhookSubscription(token, account.webhook_subscription_uri);
  } catch (err) {
    logger.warn('[CalendlyAuth] Failed to delete old webhook (may already be gone)', {
      userId: account.user_id,
      error: err.message,
    });
  }
}

async function registerUserWebhook(userId, accessToken, calendlyUser) {
  const webhookUrl = getPublicWebhookUrl(userId);
  if (!webhookUrl) {
    throw new AppError(
      'PUBLIC_BASE_URL must be set to register Calendly webhooks.',
      500,
      'CALENDLY_WEBHOOK_URL_MISSING'
    );
  }

  const organizationUri = calendlyUser.current_organization;
  const userUri = calendlyUser.uri;

  const payload = {
    url: webhookUrl,
    events: WEBHOOK_EVENTS,
    scope: organizationUri ? 'organization' : 'user',
  };

  if (organizationUri) {
    payload.organization = organizationUri;
  } else {
    payload.user = userUri;
  }

  const subscription = await createWebhookSubscription(accessToken, payload);
  return {
    webhookSubscriptionUri: subscription.uri,
    webhookSigningKey: subscription.signing_key,
  };
}

async function upsertCalendlyAccount(userId, row) {
  const { error } = await supabase.from('calendly_accounts').upsert(row, { onConflict: 'user_id' });
  if (error) {
    logger.error('[CalendlyAuth] upsert failed', { userId, message: error.message });
    throw new AppError('Failed to save Calendly account.', 500);
  }
}

async function syncUserCalendlyUrl(userId, schedulingUrl) {
  if (!schedulingUrl || !isValidCalendlyUrl(schedulingUrl)) return;
  await supabase
    .from('users')
    .update({ calendly_url: normalizeCalendlyUrl(schedulingUrl) })
    .eq('id', userId);
}

function buildConnectAuthUrl(userId) {
  assertCalendlyOAuthConfig();
  const { codeVerifier, codeChallenge } = generatePkcePair();
  const state = createConnectState(userId, codeVerifier);
  const authUrl = getAuthorizeUrl({ state, codeChallenge });
  return { authUrl, state };
}

async function completeOAuthConnect(code, state) {
  const { userId, codeVerifier } = verifyConnectState(state);
  const tokenData = await exchangeAuthorizationCode(code, codeVerifier);
  const accessToken = tokenData.access_token;

  const calendlyUser = await getCurrentUser(accessToken);
  if (!calendlyUser?.uri) {
    throw new AppError('Calendly user profile missing URI.', 502, 'CALENDLY_PROFILE_INVALID');
  }

  const existing = await findCalendlyAccountByUserId(userId);
  if (existing) {
    await deleteExistingWebhook(existing);
  }

  const webhook = await registerUserWebhook(userId, accessToken, calendlyUser);

  const row = {
    user_id: userId,
    calendly_user_uri: calendlyUser.uri,
    calendly_organization_uri: calendlyUser.current_organization || null,
    email: calendlyUser.email ? String(calendlyUser.email).trim().toLowerCase() : null,
    scheduling_url: calendlyUser.scheduling_url || null,
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token || existing?.refresh_token || null,
    token_expires_at: tokenExpiresAt(tokenData.expires_in),
    webhook_subscription_uri: webhook.webhookSubscriptionUri,
    webhook_signing_key: webhook.webhookSigningKey,
  };

  await upsertCalendlyAccount(userId, row);
  await syncUserCalendlyUrl(userId, calendlyUser.scheduling_url);

  logger.info('[CalendlyAuth] User connected Calendly', {
    userId,
    calendlyUserUri: calendlyUser.uri,
    webhook: Boolean(webhook.webhookSubscriptionUri),
  });

  return { userId, schedulingUrl: calendlyUser.scheduling_url || null };
}

async function disconnectCalendly(userId) {
  const account = await findCalendlyAccountByUserId(userId);
  if (!account) {
    throw new AppError('Calendly is not connected.', 400, 'CALENDLY_NOT_LINKED');
  }

  await deleteExistingWebhook(account);

  const { error } = await supabase.from('calendly_accounts').delete().eq('user_id', userId);
  if (error) throw new AppError('Failed to disconnect Calendly.', 500);

  return { disconnected: true };
}

async function getCalendlyAccountStatus(userId) {
  const account = await findCalendlyAccountByUserId(userId);
  if (!account) {
    return {
      connected: false,
      email: null,
      schedulingUrl: null,
      webhookActive: false,
      connectedAt: null,
    };
  }

  return {
    connected: true,
    email: account.email || null,
    schedulingUrl: account.scheduling_url || null,
    webhookActive: Boolean(account.webhook_subscription_uri && account.webhook_signing_key),
    connectedAt: account.created_at || null,
  };
}

/**
 * Booking URL for drafts: OAuth scheduling_url first, then manual users.calendly_url.
 */
async function resolveSchedulingUrlForUser(userId) {
  const account = await findCalendlyAccountByUserId(userId);
  if (account?.scheduling_url && isValidCalendlyUrl(account.scheduling_url)) {
    return account.scheduling_url;
  }

  const { data: user } = await supabase
    .from('users')
    .select('calendly_url')
    .eq('id', userId)
    .maybeSingle();

  const manual = user?.calendly_url ? String(user.calendly_url).trim() : '';
  if (manual && isValidCalendlyUrl(manual)) return manual;
  return '';
}

async function getWebhookSigningKeyForUser(userId) {
  const account = await findCalendlyAccountByUserId(userId);
  return account?.webhook_signing_key || null;
}

module.exports = {
  buildConnectAuthUrl,
  completeOAuthConnect,
  disconnectCalendly,
  getCalendlyAccountStatus,
  getValidAccessToken,
  findCalendlyAccountByUserId,
  resolveSchedulingUrlForUser,
  getWebhookSigningKeyForUser,
};
