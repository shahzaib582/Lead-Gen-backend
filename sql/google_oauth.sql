-- ============================================================
-- GOOGLE OAUTH ACCOUNTS
-- Stores Google OAuth tokens linked to users.
-- One user can have at most one linked Google account.
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'email'
  CHECK (auth_provider IN ('email', 'google'));

ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

CREATE TABLE IF NOT EXISTS google_accounts (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID        NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  google_id             TEXT        NOT NULL UNIQUE,      -- Google's "sub" field
  email                 TEXT        NOT NULL,
  name                  TEXT,
  avatar_url            TEXT,
  google_access_token   TEXT        NOT NULL,             -- Google access token (short-lived)
  google_refresh_token  TEXT,                             -- Google refresh token (long-lived, offline)
  token_expires_at      TIMESTAMPTZ,                      -- When Google access token expires
  scopes                TEXT[],                           -- Granted scopes
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_google_accounts_user_id   ON google_accounts (user_id);
CREATE INDEX IF NOT EXISTS idx_google_accounts_google_id ON google_accounts (google_id);

CREATE TRIGGER set_google_accounts_updated_at
  BEFORE UPDATE ON google_accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE google_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own google account"
  ON google_accounts FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can update own google account"
  ON google_accounts FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own google account"
  ON google_accounts FOR DELETE
  USING (user_id = auth.uid());
