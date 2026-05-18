const { google } = require('googleapis');
const logger = require('../utils/logger');
const { getSmtpConfig, getTransporter } = require('../config/smtp');
const {
  buildVerificationEmail,
  buildPasswordResetEmail,
} = require('../emails/otpTemplates');

function otpExpiryMinutes() {
  return Number(process.env.OTP_EXPIRY_MINUTES) || 10;
}

async function sendSmtpMail({ to, subject, html, text }) {
  const { from } = getSmtpConfig();
  const transport = getTransporter();

  try {
    return await transport.sendMail({ from, to, subject, html, text });
  } catch (err) {
    logger.error('SMTP send failed', {
      to,
      code: err.code,
      message: err.message,
    });
    throw err;
  }
}

async function sendOtpEmail(to, otp) {
  const expiry = otpExpiryMinutes();
  const { subject, html, text } = buildVerificationEmail(otp, expiry);
  return sendSmtpMail({ to, subject, html, text });
}

async function sendPasswordResetOtpEmail(to, otp) {
  const expiry = otpExpiryMinutes();
  const { subject, html, text } = buildPasswordResetEmail(otp, expiry);
  return sendSmtpMail({ to, subject, html, text });
}

function encodeMimeDisplayName(name) {
  const trimmed = String(name).trim();
  if (!trimmed) return '';
  if (/[\r\n]/.test(trimmed)) return '';
  if (/^[\x20-\x7e]+$/.test(trimmed)) {
    return `"${trimmed.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return `=?UTF-8?B?${Buffer.from(trimmed, 'utf8').toString('base64')}?=`;
}

function buildMimeMessage(to, subject, body, html, mimeOptions) {
  const opts = mimeOptions && typeof mimeOptions === 'object' ? mimeOptions : {};
  const recipients = Array.isArray(to) ? to.join(', ') : to;
  const lines = [];

  if (opts.fromDisplayName && opts.fromEmail) {
    const enc = encodeMimeDisplayName(opts.fromDisplayName);
    if (enc) lines.push(`From: ${enc} <${opts.fromEmail}>`);
  }

  if (opts.replyTo) {
    lines.push(`Reply-To: ${opts.replyTo}`);
  }

  lines.push(`To: ${recipients}`, `Subject: ${subject}`, 'MIME-Version: 1.0');

  if (html) {
    const boundary = `boundary_${Date.now()}`;
    lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`, '');
    lines.push(`--${boundary}`);
    lines.push('Content-Type: text/plain; charset=utf-8', '', body);
    lines.push(`--${boundary}`);
    lines.push('Content-Type: text/html; charset=utf-8', '', html);
    lines.push(`--${boundary}--`);
  } else {
    lines.push('Content-Type: text/plain; charset=utf-8', '', body);
  }

  return lines.join('\r\n');
}

async function sendCustomEmail(to, subject, body, html = null, accessToken, mimeOptions = undefined) {
  if (!accessToken) {
    throw new Error('Google access token is required to send email via Gmail API.');
  }

  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  const gmail = google.gmail({ version: 'v1', auth });
  const rawMime = buildMimeMessage(to, subject, body, html, mimeOptions);

  const raw = Buffer.from(rawMime)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const result = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw },
  });

  return { messageId: result.data.id };
}

module.exports = {
  sendOtpEmail,
  sendPasswordResetOtpEmail,
  sendCustomEmail,
};
