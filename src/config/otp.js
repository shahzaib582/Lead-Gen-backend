/**
 * OTP timing — single source of truth for storage and email copy.
 *
 * `OTP_EXPIRY_MINUTES` is what we tell the user in email.
 * `OTP_EMAIL_BUFFER_MINUTES` extends DB expiry to cover Brevo delivery delay
 * (OTP row is created before the email finishes sending).
 */

function parsePositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function getOtpExpiryMinutes() {
  return parsePositiveInt(process.env.OTP_EXPIRY_MINUTES, 10);
}

function getOtpEmailBufferMinutes() {
  return parsePositiveInt(process.env.OTP_EMAIL_BUFFER_MINUTES, 5);
}

/** Wall-clock expiry stored in `otp_codes.expires_at`. */
function getOtpStoredExpiryMs(nowMs = Date.now()) {
  const displayMinutes = getOtpExpiryMinutes();
  const bufferMinutes = getOtpEmailBufferMinutes();
  return nowMs + (displayMinutes + bufferMinutes) * 60 * 1000;
}

function getOtpMaxAttempts() {
  return parsePositiveInt(process.env.OTP_MAX_ATTEMPTS, 5);
}

function getOtpResendLimit() {
  return parsePositiveInt(process.env.OTP_RESEND_LIMIT, 5);
}

function getOtpResendWindowMinutes() {
  return parsePositiveInt(process.env.OTP_RESEND_WINDOW_MINUTES, 60);
}

module.exports = {
  getOtpExpiryMinutes,
  getOtpEmailBufferMinutes,
  getOtpStoredExpiryMs,
  getOtpMaxAttempts,
  getOtpResendLimit,
  getOtpResendWindowMinutes,
};
