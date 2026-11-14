const crypto = require('node:crypto');
const AppError = require('../utils/AppError');

function key() {
  const value = process.env.LINKED_HELPER_ENCRYPTION_KEY || '';
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new AppError('Linked Helper encryption key must be configured (32 bytes, hex).', 503);
  }
  return Buffer.from(value, 'hex');
}
function validateWebhook(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new AppError('Invalid Linked Helper webhook URL.', 400);
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    !(url.hostname === 'linkedhelper.com' || url.hostname.endsWith('.linkedhelper.com'))
  ) {
    throw new AppError(
      'Webhook must use HTTPS on linkedhelper.com without credentials or a custom port.',
      400
    );
  }
  return url.href;
}
function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((v) => v.toString('base64')).join('.');
}
function decrypt(value) {
  const [iv, tag, data] = value.split('.').map((v) => Buffer.from(v, 'base64'));
  const cipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8');
}
function profileUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new AppError('Lead needs a valid LinkedIn profile URL.', 400);
  }
  if (
    url.protocol !== 'https:' ||
    !['linkedin.com', 'www.linkedin.com'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    !/^\/in\/[^/]+\/?$/.test(url.pathname)
  ) {
    throw new AppError('Lead needs an HTTPS linkedin.com/in/ profile URL.', 400);
  }
  return `https://www.linkedin.com${url.pathname.replace(/\/$/, '')}/`;
}
async function enroll(webhook, profile, message, fetchImpl = fetch) {
  const customFields = [{ key: 'cs_source', value: 'lead-gen' }];
  if (message) customFields.push({ key: 'cs_message', value: message });
  try {
    const response = await fetchImpl(validateWebhook(webhook), {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: { people: [{ externalId: profile, customFields }] } }),
    });
    // Never persist provider response bodies: they can contain credentials or personal data.
    await response.body?.cancel();
    if (response.ok) return { status: 'accepted', http_status: response.status };
    return {
      status: response.status >= 400 && response.status < 500 ? 'rejected' : 'uncertain',
      http_status: response.status,
    };
  } catch {
    // A timeout may happen after enrollment. Do not automatically resend.
    return { status: 'uncertain', http_status: null };
  }
}
module.exports = { validateWebhook, encrypt, decrypt, profileUrl, enroll };
