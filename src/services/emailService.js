const { google } = require('googleapis');
const { sendBrevoEmail } = require('../config/brevo');
const { getOtpExpiryMinutes } = require('../config/otp');
const {
  buildVerificationEmail,
  buildPasswordResetEmail,
} = require('../emails/otpTemplates');
const { normalizeMessageId } = require('../utils/gmailThread');

async function sendOtpEmail(to, otp) {
  const expiry = getOtpExpiryMinutes();
  const { subject, html, text } = buildVerificationEmail(otp, expiry);
  return sendBrevoEmail({ to, subject, html, text });
}

async function sendPasswordResetOtpEmail(to, otp) {
  const expiry = getOtpExpiryMinutes();
  const { subject, html, text } = buildPasswordResetEmail(otp, expiry);
  return sendBrevoEmail({ to, subject, html, text });
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

  if (opts.inReplyTo) {
    lines.push(`In-Reply-To: ${normalizeMessageId(opts.inReplyTo)}`);
  }
  if (opts.references) {
    const refs = Array.isArray(opts.references) ? opts.references : [opts.references];
    const normalized = refs.filter(Boolean).map((r) => normalizeMessageId(r));
    if (normalized.length) {
      lines.push(`References: ${normalized.join(' ')}`);
    }
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

/**
 * @param {object} [threading]
 * @param {string} [threading.threadId] Gmail thread to append to
 * @param {string} [threading.inReplyTo] RFC Message-ID of parent
 * @param {string|string[]} [threading.references] RFC References chain
 */
async function sendCustomEmail(
  to,
  subject,
  body,
  html = null,
  accessToken,
  mimeOptions = undefined,
  threading = undefined
) {
  if (!accessToken) {
    throw new Error('Google access token is required to send email via Gmail API.');
  }

  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  const gmail = google.gmail({ version: 'v1', auth });

  const mergedMime = { ...(mimeOptions || {}) };
  if (threading?.inReplyTo) {
    mergedMime.inReplyTo = threading.inReplyTo;
    mergedMime.references = threading.references || threading.inReplyTo;
  }

  const rawMime = buildMimeMessage(to, subject, body, html, mergedMime);

  const raw = Buffer.from(rawMime)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const requestBody = { raw };
  if (threading?.threadId) {
    requestBody.threadId = threading.threadId;
  }

  const result = await gmail.users.messages.send({
    userId: 'me',
    requestBody,
  });

  return {
    messageId: result.data.id,
    threadId: result.data.threadId || threading?.threadId || null,
  };
}

/**
 * Create a Gmail draft (not sent). Requires gmail.compose scope.
 * @returns {Promise<{ draftId: string, messageId: string|null }>}
 */
async function createGmailDraft(accessToken, { to, subject, body, mimeOptions, threading }) {
  if (!accessToken) {
    throw new Error('Google access token is required to create a Gmail draft.');
  }

  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  const gmail = google.gmail({ version: 'v1', auth });

  const mergedMime = { ...(mimeOptions || {}) };
  if (threading?.inReplyTo) {
    mergedMime.inReplyTo = threading.inReplyTo;
    mergedMime.references = threading.references || threading.inReplyTo;
  }

  const rawMime = buildMimeMessage(to, subject, body, null, mergedMime);
  const raw = Buffer.from(rawMime)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const message = { raw };
  if (threading?.threadId) {
    message.threadId = threading.threadId;
  }

  const { data } = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: { message },
  });

  return {
    draftId: data.id,
    messageId: data.message?.id || null,
  };
}

module.exports = {
  sendOtpEmail,
  sendPasswordResetOtpEmail,
  sendCustomEmail,
  createGmailDraft,
  buildMimeMessage,
};
