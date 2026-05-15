-- Purpose distinguishes signup email OTP vs password-reset OTP on the same user_id row stream.

ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'email_verify'
  CHECK (purpose IN ('email_verify', 'password_reset'));

CREATE INDEX IF NOT EXISTS idx_otp_codes_user_purpose ON otp_codes (user_id, purpose);
