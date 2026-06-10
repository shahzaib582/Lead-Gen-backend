const { randomUUID } = require('crypto');
const { getPublicBaseUrl } = require('./publicBaseUrl');

function createOpenTrackingToken() {
  return randomUUID();
}

function normalizeTrackingToken(raw) {
  if (!raw) return null;
  const token = String(raw).replace(/\.gif$/i, '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null;
  return token;
}

function getOpenTrackingPixelUrl(token) {
  const base = getPublicBaseUrl();
  return `${base}/api/tracking/open/${encodeURIComponent(token)}.gif`;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildTrackedHtmlEmail(plainBody, trackingToken) {
  const pixelUrl = getOpenTrackingPixelUrl(trackingToken);
  const htmlBody = escapeHtml(plainBody).replace(/\n/g, '<br>\n');
  return `<!DOCTYPE html><html><body>${htmlBody}<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none" /></body></html>`;
}

module.exports = {
  createOpenTrackingToken,
  normalizeTrackingToken,
  getOpenTrackingPixelUrl,
  buildTrackedHtmlEmail,
};
