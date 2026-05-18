const nodemailer = require('nodemailer');

const REQUIRED_ENV = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM'];

let transporter;

function getSmtpConfig() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(`SMTP not configured (missing: ${missing.join(', ')})`);
  }

  return {
    host: process.env.SMTP_HOST.trim(),
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER.trim(),
    pass: process.env.SMTP_PASS,
    from: process.env.EMAIL_FROM,
  };
}

function getTransporter() {
  if (transporter) return transporter;

  const { host, port, secure, user, pass } = getSmtpConfig();

  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  return transporter;
}

module.exports = {
  getSmtpConfig,
  getTransporter,
};
