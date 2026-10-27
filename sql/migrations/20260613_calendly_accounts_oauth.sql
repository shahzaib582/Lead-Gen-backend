-- Per-user Calendly OAuth + webhook subscription (multi-tenant booking sync).
CREATE TABLE IF NOT EXISTS calendly_accounts (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID        NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

  calendly_user_uri         TEXT        NOT NULL,
  calendly_organization_uri TEXT,
  email                     TEXT,
  scheduling_url            TEXT,

  access_token              TEXT        NOT NULL,
  refresh_token             TEXT,
  token_expires_at          TIMESTAMPTZ,

  webhook_subscription_uri  TEXT,
  webhook_signing_key       TEXT,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calendly_accounts_user_id ON calendly_accounts (user_id);
CREATE INDEX IF NOT EXISTS idx_calendly_accounts_calendly_user_uri ON calendly_accounts (calendly_user_uri);

DROP TRIGGER IF EXISTS set_calendly_accounts_updated_at ON calendly_accounts;
CREATE TRIGGER set_calendly_accounts_updated_at
  BEFORE UPDATE ON calendly_accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE calendly_accounts IS
  'OAuth-linked Calendly per platform user. Webhook signing key is per subscription.';
