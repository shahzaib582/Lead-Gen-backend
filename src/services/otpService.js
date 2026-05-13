const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const supabase = require('../config/supabase');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

const OTP_EXPIRY_MINUTES = Number(process.env.OTP_EXPIRY_MINUTES) || 10;
const OTP_MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS) || 5;
const OTP_RESEND_LIMIT = Number(process.env.OTP_RESEND_LIMIT) || 5;
const OTP_RESEND_WINDOW = Number(process.env.OTP_RESEND_WINDOW_MINUTES) || 60;
const BCRYPT_ROUNDS = 10;

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
  const windowStart = new Date(Date.now() - OTP_RESEND_WINDOW * 60 * 1000).toISOString();

  const { count, error } = await supabase
    .from('otp_rate_limits')
    .select('*', { count: 'exact', head: true })
    .eq('email', email)
    .gte('sent_at', windowStart);

  if (error) throw new AppError('Database error checking rate limit', 500);

  if (count >= OTP_RESEND_LIMIT) {
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
 * @returns {string}        - Plaintext OTP
 */
async function createOtp(userId, email) {
  await enforceResendRateLimit(email);

  // Invalidate old unused OTPs for this user (mark as used)
  await supabase.from('otp_codes').update({ used: true }).eq('user_id', userId).eq('used', false);

  const plainOtp = generateOtp();
  const codeHash = await bcrypt.hash(plainOtp, BCRYPT_ROUNDS);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();

  const { error } = await supabase
    .from('otp_codes')
    .insert({ user_id: userId, code_hash: codeHash, expires_at: expiresAt });

  if (error) {
    logger.error('Failed to store OTP', { error });
    throw new AppError('Failed to create verification code', 500);
  }

  return plainOtp;
}

// ─── Verify OTP ───────────────────────────────────────────────────────────────

/**
 * Verify a submitted OTP for a given user.
 * - Increments attempt counter on failure (brute-force protection)
 * - Marks OTP as used on success
 *
 * @param {string} userId
 * @param {string} submittedOtp  - Plaintext OTP from the user
 */
async function verifyOtp(userId, submittedOtp) {
  // Fetch the latest valid (unused, non-expired) OTP for this user
  const { data: otpRecord, error } = await supabase
    .from('otp_codes')
    .select('*')
    .eq('user_id', userId)
    .eq('used', false)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !otpRecord) {
    throw new AppError('No valid verification code found. Please request a new one.', 400);
  }

  // Check if too many failed attempts
  if (otpRecord.attempts >= OTP_MAX_ATTEMPTS) {
    // Invalidate it
    await supabase.from('otp_codes').update({ used: true }).eq('id', otpRecord.id);
    throw new AppError('Too many incorrect attempts. Please request a new verification code.', 429);
  }

  const isMatch = await bcrypt.compare(submittedOtp, otpRecord.code_hash);

  if (!isMatch) {
    // Increment attempts
    await supabase
      .from('otp_codes')
      .update({ attempts: otpRecord.attempts + 1 })
      .eq('id', otpRecord.id);

    const remaining = OTP_MAX_ATTEMPTS - (otpRecord.attempts + 1);
    throw new AppError(`Invalid verification code. ${remaining} attempt(s) remaining.`, 400);
  }

  // Mark as used
  await supabase.from('otp_codes').update({ used: true }).eq('id', otpRecord.id);

  logger.info('OTP verified successfully', { userId });
}

module.exports = { createOtp, verifyOtp };
