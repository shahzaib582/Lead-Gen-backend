const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const CALENDLY_AUTH_BASE = 'https://auth.calendly.com';
const CALENDLY_API_BASE = 'https://api.calendly.com';

const OAUTH_SCOPES = ['scheduled_events:read', 'webhooks:write'];

function getJwtSecret() {
  return process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET;
}

function getCalendlyOAuthConfig() {
  const clientId = process.env.CALENDLY_CLIENT_ID;
  const clientSecret = process.env.CALENDLY_CLIENT_SECRET;
  const redirectUri = process.env.CALENDLY_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return null;
  }

  return { clientId, clientSecret, redirectUri };
}

function assertCalendlyOAuthConfig() {
  const config = getCalendlyOAuthConfig();
  if (!config) {
    throw new Error(
      'Calendly OAuth is not configured. Set CALENDLY_CLIENT_ID, CALENDLY_CLIENT_SECRET, and CALENDLY_REDIRECT_URI.'
    );
  }
  return config;
}

function toBase64Url(buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function generatePkcePair() {
  const codeVerifier = toBase64Url(crypto.randomBytes(32));
  const codeChallenge = toBase64Url(crypto.createHash('sha256').update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

function createConnectState(userId, codeVerifier) {
  const secret = getJwtSecret();
  if (!secret) {
    throw new Error('JWT_ACCESS_SECRET or JWT_SECRET is required for Calendly OAuth state.');
  }
  return jwt.sign({ userId, codeVerifier, purpose: 'calendly_connect' }, secret, {
    expiresIn: '15m',
  });
}

function verifyConnectState(state) {
  const secret = getJwtSecret();
  if (!secret) {
    throw new Error('JWT_ACCESS_SECRET or JWT_SECRET is required for Calendly OAuth state.');
  }
  const payload = jwt.verify(state, secret);
  if (!payload || payload.purpose !== 'calendly_connect' || !payload.userId || !payload.codeVerifier) {
    throw new Error('Invalid Calendly OAuth state.');
  }
  return { userId: payload.userId, codeVerifier: payload.codeVerifier };
}

function getAuthorizeUrl({ state, codeChallenge }) {
  const { clientId, redirectUri } = assertCalendlyOAuthConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    state,
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
    scope: OAUTH_SCOPES.join(' '),
  });
  return `${CALENDLY_AUTH_BASE}/oauth/authorize?${params.toString()}`;
}

function getPublicWebhookUrl(userId) {
  const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (!base) return null;
  return `${base}/api/calendly/webhooks/${userId}`;
}

function getFrontendRedirectUrl(query = {}) {
  const base = (process.env.FRONTEND_URL || 'http://localhost:8080').replace(/\/$/, '');
  const params = new URLSearchParams(query);
  const qs = params.toString();
  return `${base}/settings/integrations${qs ? `?${qs}` : ''}`;
}

module.exports = {
  CALENDLY_AUTH_BASE,
  CALENDLY_API_BASE,
  OAUTH_SCOPES,
  getCalendlyOAuthConfig,
  assertCalendlyOAuthConfig,
  generatePkcePair,
  createConnectState,
  verifyConnectState,
  getAuthorizeUrl,
  getPublicWebhookUrl,
  getFrontendRedirectUrl,
};
