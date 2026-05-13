const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

let transporter;

function getTransporter() {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  return transporter;
}

/**
 * Send an OTP verification email (uses SMTP / nodemailer — no Google token needed).
 * @param {string} to  - Recipient email address
 * @param {string} otp - Plaintext 6-digit OTP
 */
async function sendOtpEmail(to, otp) {
  const transport = getTransporter();

  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
      <title>Email Verification</title>
    </head>
    <body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0;">
        <tr>
          <td align="center">
            <table width="480" cellpadding="0" cellspacing="0"
                   style="background:#ffffff;border-radius:8px;padding:40px;
                          box-shadow:0 2px 8px rgba(0,0,0,0.08);">
              <tr>
                <td align="center" style="padding-bottom:24px;">
                  <h2 style="margin:0;color:#1a1a1a;font-size:22px;">Verify Your Email</h2>
                </td>
              </tr>
              <tr>
                <td align="center" style="padding-bottom:16px;color:#555;font-size:15px;line-height:1.6;">
                  Use the code below to verify your email address.
                  This code expires in <strong>${process.env.OTP_EXPIRY_MINUTES || 10} minutes</strong>.
                </td>
              </tr>
              <tr>
                <td align="center" style="padding:20px 0;">
                  <div style="display:inline-block;background:#f0f4ff;border:1px solid #c7d4f7;
                              border-radius:8px;padding:16px 40px;">
                    <span style="font-size:36px;font-weight:bold;letter-spacing:12px;color:#3b5bdb;">
                      ${otp}
                    </span>
                  </div>
                </td>
              </tr>
              <tr>
                <td align="center" style="padding-top:16px;color:#888;font-size:13px;">
                  If you did not request this, please ignore this email.
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  const info = await transport.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject: 'Your verification code',
    html,
    text: `Your verification code is: ${otp}\nIt expires in ${process.env.OTP_EXPIRY_MINUTES || 10} minutes.`,
  });

  logger.info('OTP email sent', { to, messageId: info.messageId });
  return info;
}

/**
 * Send a custom email via the Gmail API using the user's Google OAuth access token.
 * This sends as the authenticated Google user (their Gmail address), which is
 * essential for lead-gen outreach.
 *
 * @param {string|string[]} to  - Recipient email address(es)
 * @param {string} subject      - Email subject line
 * @param {string} body         - Plain-text body
 * @param {string|null} html    - Optional HTML body
 * @param {string} accessToken  - Valid Google OAuth2 access token for the sending user
 */
async function sendCustomEmail(to, subject, body, html = null, accessToken) {
  if (!accessToken) {
    throw new Error('Google access token is required to send email via Gmail API.');
  }

  // Authenticate against Gmail API with the user's token
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  const gmail = google.gmail({ version: 'v1', auth });

  const recipients = Array.isArray(to) ? to.join(', ') : to;

  // Build a MIME message
  const mimeLines = [`To: ${recipients}`, `Subject: ${subject}`, 'MIME-Version: 1.0'];

  if (html) {
    // Multipart message: plain text + HTML
    const boundary = `boundary_${Date.now()}`;
    mimeLines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    mimeLines.push('');
    mimeLines.push(`--${boundary}`);
    mimeLines.push('Content-Type: text/plain; charset=utf-8');
    mimeLines.push('');
    mimeLines.push(body);
    mimeLines.push(`--${boundary}`);
    mimeLines.push('Content-Type: text/html; charset=utf-8');
    mimeLines.push('');
    mimeLines.push(html);
    mimeLines.push(`--${boundary}--`);
  } else {
    // Plain text only
    mimeLines.push('Content-Type: text/plain; charset=utf-8');
    mimeLines.push('');
    mimeLines.push(body);
  }

  // Gmail API expects base64url-encoded raw RFC 2822 message
  const raw = Buffer.from(mimeLines.join('\r\n'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const result = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw },
  });

  const messageId = result.data.id;

  logger.info('Custom email sent via Gmail API', {
    to: Array.isArray(to) ? to : [to],
    subject,
    messageId,
  });

  return { messageId };
}

module.exports = { sendOtpEmail, sendCustomEmail };
