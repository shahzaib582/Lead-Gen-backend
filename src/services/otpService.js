const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const supabase = require('../config/supabase');
const {
  getOtpStoredExpiryMs,
  getOtpMaxAttempts,
  getOtpResendLimit,
  getOtpResendWindowMinutes,
} = require('../config/otp');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

const BCRYPT_ROUNDS = 10;

const OTP_PURPOSE_EMAIL_VERIFY = 'email_verify';
const OTP_PURPOSE_PASSWORD_RESET = 'password_reset';

// ─── Generate ─────────────────────────────────────────────────────────────────

/**
 * Generate a cryptographically-random 6-digit OTP string.
 */
function generateOtp() {
  // Use crypto.randomInt to avoid modulo bias
  const code = crypto.randomInt(0, 1_000_000);
  return code.toString().padStart(6, '0');
}

// ─── Rate Limit ───────────────────────────────────────────────────────────────

/**
 * Throw 429 if the email has exceeded the resend limit within the rolling window.
 */
async function enforceResendRateLimit(email) {
  const windowMinutes = getOtpResendWindowMinutes();
  const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();

  const { count, error } = await supabase
    .from('otp_rate_limits')
    .select('*', { count: 'exact', head: true })
    .eq('email', email)
    .gte('sent_at', windowStart);

  if (error) throw new AppError('Database error checking rate limit', 500);

  if (count >= getOtpResendLimit()) {
    throw new AppError(`Too many OTP requests. Please wait before requesting another code.`, 429);
  }

  // Record this send
  const { error: insertError } = await supabase.from('otp_rate_limits').insert({ email });

  if (insertError) throw new AppError('Database error recording rate limit', 500);
}

// ─── Create & Store OTP ───────────────────────────────────────────────────────

/**
 * Invalidate any existing unused OTPs for a user, create a new hashed one,
 * and return the plaintext OTP to send via email.
 *
 * @param {string} userId
 * @param {string} email    - Used for rate limiting
 * @param {string} purpose  - `email_verify` | `password_reset` (requires `otp_codes.purpose` — see `sql/schema.sql`)
 * @returns {string}        - Plaintext OTP
 */
async function createOtp(userId, email, purpose = OTP_PURPOSE_EMAIL_VERIFY) {
  await enforceResendRateLimit(email);

  await supabase
    .from('otp_codes')
    .update({ used: true })
    .eq('user_id', userId)
    .eq('used', false)
    .eq('purpose', purpose);

  const plainOtp = generateOtp();
  const codeHash = await bcrypt.hash(plainOtp, BCRYPT_ROUNDS);
  const expiresAt = new Date(getOtpStoredExpiryMs()).toISOString();

  const { error } = await supabase.from('otp_codes').insert({
    user_id: userId,
    code_hash: codeHash,
    expires_at: expiresAt,
    purpose,
  });

  if (error) {
    logger.error('Failed to store OTP', { error, purpose });
    throw new AppError('Failed to create verification code', 500);
  }

  return plainOtp;
}

/**
 * True when the user already has an unused, unexpired OTP for this purpose.
 */
async function hasActiveOtp(userId, purpose = OTP_PURPOSE_EMAIL_VERIFY) {
  const { count, error } = await supabase
    .from('otp_codes')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('purpose', purpose)
    .eq('used', false)
    .gt('expires_at', new Date().toISOString());

  if (error) throw new AppError('Database error', 500);
  return count > 0;
}

// ─── Verify OTP ───────────────────────────────────────────────────────────────

/**
 * Verify a submitted OTP for a given user.
 * - Increments attempt counter on failure (brute-force protection)
 * - Marks OTP as used on success when consume is true (default)
 *
 * @param {string} userId
 * @param {string} submittedOtp  - Plaintext OTP from the user
 * @param {string} purpose       - `email_verify` | `password_reset`
 * @param {{ consume?: boolean }} [options] - Set consume:false to validate without marking used
 * @returns {Promise<string>} otp record id (for deferred consume)
 */
async function verifyOtp(userId, submittedOtp, purpose = OTP_PURPOSE_EMAIL_VERIFY, options = {}) {
  const { consume = true } = options;
  const { data: otpRecord, error } = await supabase
    .from('otp_codes')
    .select('*')
    .eq('user_id', userId)
    .eq('purpose', purpose)
    .eq('used', false)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !otpRecord) {
    throw new AppError('No valid verification code found. Please request a new one.', 400);
  }

  // Check if too many failed attempts
  if (otpRecord.attempts >= getOtpMaxAttempts()) {
    await supabase.from('otp_codes').update({ used: true }).eq('id', otpRecord.id);
    throw new AppError('Too many incorrect attempts. Please request a new verification code.', 429);
  }

  const isMatch = await bcrypt.compare(submittedOtp, otpRecord.code_hash);

  if (!isMatch) {
    await supabase
      .from('otp_codes')
      .update({ attempts: otpRecord.attempts + 1 })
      .eq('id', otpRecord.id);

    const remaining = getOtpMaxAttempts() - (otpRecord.attempts + 1);
    throw new AppError(`Invalid verification code. ${remaining} attempt(s) remaining.`, 400);
  }

  if (consume) {
    await supabase.from('otp_codes').update({ used: true }).eq('id', otpRecord.id);
  }

  return otpRecord.id;
}

async function consumeOtp(otpId) {
  const { error } = await supabase.from('otp_codes').update({ used: true }).eq('id', otpId);
  if (error) throw new AppError('Failed to finalize verification code.', 500);
}

module.exports = {
  createOtp,
  verifyOtp,
  consumeOtp,
  hasActiveOtp,
  OTP_PURPOSE_EMAIL_VERIFY,
  OTP_PURPOSE_PASSWORD_RESET,
};
