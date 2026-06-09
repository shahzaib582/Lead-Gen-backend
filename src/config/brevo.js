const logger = require('../utils/logger');

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

const REQUIRED_ENV = ['BREVO_API_KEY', 'BREVO_SENDER_EMAIL'];

function getBrevoConfig() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(`Brevo not configured (missing: ${missing.join(', ')})`);
  }

  const senderEmail = process.env.BREVO_SENDER_EMAIL.trim();
  const senderName =
    process.env.BREVO_SENDER_NAME?.trim() ||
    process.env.APP_NAME?.trim() ||
    'Lead Gen';

  return {
    apiKey: process.env.BREVO_API_KEY.trim(),
    sender: { email: senderEmail, name: senderName },
  };
}

/**
 * Send a transactional email via Brevo HTTP API.
 * @param {{ to: string, subject: string, html: string, text?: string }} params
 */
async function sendBrevoEmail({ to, subject, html, text }) {
  const { apiKey, sender } = getBrevoConfig();

  const body = {
    sender,
    to: [{ email: String(to).trim() }],
    subject,
    htmlContent: html,
  };
  if (text) body.textContent = text;

  const res = await fetch(BREVO_API_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { raw };
  }

  if (!res.ok) {
    const message = data.message || data.error || res.statusText || 'Brevo API error';
    logger.error('Brevo send failed', {
      to,
      status: res.status,
      message,
      code: data.code,
    });
    const err = new Error(message);
    err.statusCode = res.status >= 400 && res.status < 500 ? 400 : 502;
    err.code = 'BREVO_SEND_FAILED';
    throw err;
  }

  return data;
}

module.exports = { getBrevoConfig, sendBrevoEmail };
