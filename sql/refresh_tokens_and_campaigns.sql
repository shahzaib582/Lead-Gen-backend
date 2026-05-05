-- ============================================================
-- REFRESH TOKENS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT        NOT NULL UNIQUE,   -- SHA-256 hash of the actual token
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_token_hash    ON refresh_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_token_user_id ON refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_token_expires  ON refresh_tokens (expires_at);

-- ============================================================
-- CAMPAIGNS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS campaigns (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Core fields
  name             TEXT        NOT NULL,
  goal             TEXT        NOT NULL,   -- e.g. "Generate 100 leads", "Book 20 demos"
  target_zone      TEXT        NOT NULL,   -- Geographic or demographic target zone
  call_to_action   TEXT        NOT NULL,   -- e.g. "Book a Demo", "Sign Up Free"
  run_mode         TEXT        NOT NULL    CHECK (run_mode IN ('manual', 'scheduled', 'auto')),
  mail_template    TEXT,                   -- Email template body (HTML or plain text)
  example_training TEXT,                  -- Training examples / prompt for AI
  target_leads     INT         NOT NULL DEFAULT 0,  -- Number of leads to target

  -- Status tracking
  status           TEXT        NOT NULL DEFAULT 'draft'
                               CHECK (status IN ('draft', 'active', 'paused', 'completed')),

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_user_id ON campaigns (user_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status  ON campaigns (status);

-- Auto-update updated_at
CREATE TRIGGER set_campaigns_updated_at
  BEFORE UPDATE ON campaigns
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
