const CALENDLY_HOST_PATTERN = /^(?:[a-z0-9-]+\.)*calendly\.com$/i;

const UTM_SOURCE = 'leadgen';
const UTM_MEDIUM = 'email';

/**
 * @param {string} url
 * @returns {boolean}
 */
function isValidCalendlyUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return false;
    return CALENDLY_HOST_PATTERN.test(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Normalize user-provided Calendly URL (trim, drop trailing slash on path).
 * @param {string} url
 * @returns {string}
 */
function normalizeCalendlyUrl(url) {
  const parsed = new URL(String(url).trim());
  parsed.hash = '';
  let path = parsed.pathname.replace(/\/+$/, '');
  if (!path) path = '/';
  parsed.pathname = path;
  return parsed.toString();
}

/**
 * Append UTM params so webhooks can match campaign leads.
 * @param {string} baseUrl
 * @param {{ campaignId?: string|null, campaignLeadId?: string|null }} [tracking]
 * @returns {string}
 */
function buildCalendlyBookingLink(baseUrl, tracking = {}) {
  if (!baseUrl) return '';
  const normalized = normalizeCalendlyUrl(baseUrl);
  const parsed = new URL(normalized);
  parsed.searchParams.set('utm_source', UTM_SOURCE);
  parsed.searchParams.set('utm_medium', UTM_MEDIUM);
  if (tracking.campaignId) {
    parsed.searchParams.set('utm_campaign', String(tracking.campaignId));
  }
  if (tracking.campaignLeadId) {
    parsed.searchParams.set('utm_content', String(tracking.campaignLeadId));
  }
  return parsed.toString();
}

/**
 * @param {string} uri - Calendly API resource URI
 * @returns {string|null}
 */
function uuidFromCalendlyUri(uri) {
  if (!uri || typeof uri !== 'string') return null;
  const parts = uri.replace(/\/+$/, '').split('/');
  const last = parts[parts.length - 1];
  return last && /^[a-f0-9-]{36}$/i.test(last) ? last : null;
}

module.exports = {
  isValidCalendlyUrl,
  normalizeCalendlyUrl,
  buildCalendlyBookingLink,
  uuidFromCalendlyUri,
  UTM_SOURCE,
  UTM_MEDIUM,
};
