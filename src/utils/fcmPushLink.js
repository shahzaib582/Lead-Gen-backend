/**
 * @param {Record<string, unknown>} notification Public notification from API
 */
function resolveFrontendOrigin() {
  const raw = process.env.FRONTEND_URL || process.env.CORS_ORIGIN || 'http://localhost:8080';
  const first = String(raw).split(',')[0].trim();
  return first.replace(/\/$/, '');
}

function buildNotificationDeepLink(notification) {
  const base = resolveFrontendOrigin();
  if (notification.campaignId) {
    return `${base}/campaigns/${notification.campaignId}`;
  }
  if (notification.meetingId) {
    return `${base}/meetings`;
  }
  return `${base}/notifications`;
}

/**
 * FCM data payload values must be strings.
 * @param {Record<string, unknown>} obj
 */
function fcmStringData(obj) {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) out[key] = '';
    else if (typeof value === 'object') out[key] = JSON.stringify(value);
    else out[key] = String(value);
  }
  return out;
}

module.exports = { resolveFrontendOrigin, buildNotificationDeepLink, fcmStringData };
