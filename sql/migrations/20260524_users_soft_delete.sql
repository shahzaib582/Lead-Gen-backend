-- Soft-delete accounts: block login/API; allow same email to sign up again after delete.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

COMMENT ON COLUMN users.deleted_at IS
  'When set, the account is deactivated; login, refresh, and Bearer access are rejected.';

-- Replace global email UNIQUE with partial index (active accounts only).
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_active
  ON users (email)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users (deleted_at)
  WHERE deleted_at IS NOT NULL;
