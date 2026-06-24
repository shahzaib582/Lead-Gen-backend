const {
  CALENDLY_AUTH_BASE,
  CALENDLY_API_BASE,
  assertCalendlyOAuthConfig,
} = require('../config/calendlyOAuth');

async function parseJsonResponse(httpRes) {
  const raw = await httpRes.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { raw };
  }
  return { ok: httpRes.ok, status: httpRes.status, data };
}

async function exchangeAuthorizationCode(code, codeVerifier) {
  const { clientId, clientSecret, redirectUri } = assertCalendlyOAuthConfig();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });

  const httpRes = await fetch(`${CALENDLY_AUTH_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const { ok, status, data } = await parseJsonResponse(httpRes);
  if (!ok) {
    const message = data.error_description || data.error || data.message || `HTTP ${status}`;
    const err = new Error(message);
    err.statusCode = status >= 400 && status < 500 ? 400 : 502;
    err.code = 'CALENDLY_TOKEN_EXCHANGE_FAILED';
    throw err;
  }
  return data;
}

async function refreshAccessToken(refreshToken) {
  const { clientId, clientSecret } = assertCalendlyOAuthConfig();
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });

  const httpRes = await fetch(`${CALENDLY_AUTH_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const { ok, status, data } = await parseJsonResponse(httpRes);
  if (!ok) {
    const message = data.error_description || data.error || data.message || `HTTP ${status}`;
    const err = new Error(message);
    err.statusCode = status >= 400 && status < 500 ? 400 : 502;
    err.code = 'CALENDLY_TOKEN_REFRESH_FAILED';
    throw err;
  }
  return data;
}

async function calendlyApiRequest(accessToken, method, pathOrUri, body = undefined) {
  const url = pathOrUri.startsWith('http')
    ? pathOrUri
    : `${CALENDLY_API_BASE}${pathOrUri.startsWith('/') ? pathOrUri : `/${pathOrUri}`}`;

  const httpRes = await fetch(url, {
    method,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${accessToken}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const { ok, status, data } = await parseJsonResponse(httpRes);
  if (!ok) {
    const message = data.message || data.title || data.error || `Calendly API HTTP ${status}`;
    const err = new Error(message);
    err.statusCode = status;
    err.code = 'CALENDLY_API_ERROR';
    err.calendly = data;
    throw err;
  }
  return data;
}

async function getCurrentUser(accessToken) {
  const data = await calendlyApiRequest(accessToken, 'GET', '/users/me');
  return data.resource;
}

async function createWebhookSubscription(accessToken, payload) {
  const data = await calendlyApiRequest(accessToken, 'POST', '/webhook_subscriptions', payload);
  return data.resource;
}

async function deleteWebhookSubscription(accessToken, subscriptionUri) {
  await calendlyApiRequest(accessToken, 'DELETE', subscriptionUri);
}

async function fetchCalendlyResource(accessToken, uri) {
  const data = await calendlyApiRequest(accessToken, 'GET', uri);
  return data.resource || null;
}

module.exports = {
  exchangeAuthorizationCode,
  refreshAccessToken,
  calendlyApiRequest,
  getCurrentUser,
  createWebhookSubscription,
  deleteWebhookSubscription,
  fetchCalendlyResource,
};
