-- =====================================================================
-- Lead Gen backend — Postgres / Supabase schema (single file).
--
-- Greenfield: run once on an empty database.
-- Existing DB: CREATE TABLE IF NOT EXISTS does not ALTER tables — add columns manually to match.
--
-- External tables used by the API (define via import / Supabase UI): leads_data,
-- linkedinscrapping, webscrapping (shapes vary by project).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── Shared trigger helper ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── users ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT        NOT NULL,
  password_hash   TEXT,                   -- nullable for Google-only accounts
  auth_provider   TEXT        NOT NULL DEFAULT 'email'
                    CHECK (auth_provider IN ('email', 'google')),
  is_verified     BOOLEAN     NOT NULL DEFAULT FALSE,

  name            TEXT,
  profile_pic     TEXT,
  address         TEXT,
  contact         TEXT,
  role            TEXT        NOT NULL DEFAULT 'user'
                    CHECK (role IN ('user', 'superadmin')),
  timezone        TEXT,
  notifications_enabled BOOLEAN NOT NULL DEFAULT true,
  deleted_at      TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN users.timezone IS
  'Optional IANA timezone for scheduling. When null, meetings use UTC.';

COMMENT ON COLUMN users.notifications_enabled IS
  'When false, notification rows are still saved; SSE and FCM push are not sent.';

COMMENT ON COLUMN users.deleted_at IS
  'When set, the account is deactivated; login, refresh, and Bearer access are rejected.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_active
  ON users (email)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users (deleted_at)
  WHERE deleted_at IS NOT NULL;

DROP TRIGGER IF EXISTS set_users_updated_at ON users;
CREATE TRIGGER set_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ─── otp_codes ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS otp_codes (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash     TEXT        NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  attempts      INT         NOT NULL DEFAULT 0,
  used          BOOLEAN     NOT NULL DEFAULT FALSE,
  purpose       TEXT        NOT NULL DEFAULT 'email_verify'
                  CHECK (purpose IN ('email_verify', 'password_reset')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_otp_user_id ON otp_codes (user_id);
CREATE INDEX IF NOT EXISTS idx_otp_expires_at ON otp_codes (expires_at);
CREATE INDEX IF NOT EXISTS idx_otp_codes_user_purpose ON otp_codes (user_id, purpose);

-- ─── otp_rate_limits ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS otp_rate_limits (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT        NOT NULL,
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_email ON otp_rate_limits (email);
CREATE INDEX IF NOT EXISTS idx_rate_limit_sent_at ON otp_rate_limits (sent_at);

-- ─── refresh_tokens ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT        NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_token_hash ON refresh_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_token_user_id ON refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_token_expires ON refresh_tokens (expires_at);

-- ─── campaigns ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS campaigns (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  name               TEXT        NOT NULL,
  goal               TEXT        NOT NULL,
  target_zone        TEXT        NOT NULL,
  call_to_action     TEXT        NOT NULL,
  target_tone        TEXT        NOT NULL DEFAULT 'Professional'
                       CHECK (target_tone IN ('Friendly', 'Professional', 'Direct', 'Consultative')),
  run_mode           TEXT        NOT NULL CHECK (run_mode IN ('manual', 'scheduled', 'auto')),
  mail_training_instruction TEXT,
  mail_template_samples    JSONB NOT NULL DEFAULT '[]'::jsonb,
  target_leads       INT         NOT NULL DEFAULT 0,

  lead_source        TEXT        DEFAULT 'both'
                       CHECK (lead_source IS NULL OR lead_source IN ('new', 'old', 'both')),
  sender_display_name TEXT,
  sender_address      TEXT,
  sender_phone        TEXT,

  status             TEXT        NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft', 'active', 'paused', 'completed')),

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_user_id ON campaigns (user_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns (status);

COMMENT ON COLUMN campaigns.sender_display_name IS
  'Optional display name paired with Google account email for From header.';

COMMENT ON COLUMN campaigns.mail_training_instruction IS
  'Optional natural-language instructions for tone, voice, and constraints when generating per-lead emails.';

COMMENT ON COLUMN campaigns.mail_template_samples IS
  'JSON array of example emails for the model: [{ "subject"?, "body"?, "html"?, "text"? }, ...]. At least one content field per object.';

COMMENT ON COLUMN campaigns.target_tone IS
  'Outbound email tone: Friendly | Professional | Direct | Consultative.';

DROP TRIGGER IF EXISTS set_campaigns_updated_at ON campaigns;
CREATE TRIGGER set_campaigns_updated_at
  BEFORE UPDATE ON campaigns
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ─── google_accounts ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS google_accounts (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID        NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  google_id             TEXT        NOT NULL UNIQUE,
  email                 TEXT        NOT NULL,
  name                  TEXT,
  avatar_url            TEXT,
  google_access_token   TEXT        NOT NULL,
  google_refresh_token  TEXT,
  token_expires_at      TIMESTAMPTZ,
  scopes                TEXT[],
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_google_accounts_user_id ON google_accounts (user_id);
CREATE INDEX IF NOT EXISTS idx_google_accounts_google_id ON google_accounts (google_id);

DROP TRIGGER IF EXISTS set_google_accounts_updated_at ON google_accounts;
CREATE TRIGGER set_google_accounts_updated_at
  BEFORE UPDATE ON google_accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE google_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own google account" ON google_accounts;
DROP POLICY IF EXISTS "Users can update own google account" ON google_accounts;
DROP POLICY IF EXISTS "Users can delete own google account" ON google_accounts;

CREATE POLICY "Users can view own google account"
  ON google_accounts FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can update own google account"
  ON google_accounts FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own google account"
  ON google_accounts FOR DELETE
  USING (user_id = auth.uid());

-- ─── campaign_leads (junction: campaigns ↔ leads_data string ids) ─────────

CREATE TABLE IF NOT EXISTS campaign_leads (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id    UUID        NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,

  lead_data_id   TEXT        NOT NULL,
  mail_template  TEXT,
  status         TEXT        NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'template_generated', 'sent', 'failed', 'skipped')),
  error_message  TEXT,
  sent_at        TIMESTAMPTZ,

  gmail_thread_id       TEXT,
  gmail_message_id      TEXT,
  gmail_subject         TEXT,
  gmail_rfc_message_id  TEXT,
  reply_received        BOOLEAN     NOT NULL DEFAULT false,
  reply_received_at     TIMESTAMPTZ,
  thank_you_draft_gmail_id TEXT,
  thank_you_draft_created_at TIMESTAMPTZ,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (campaign_id, lead_data_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_leads_campaign_id ON campaign_leads (campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_leads_user_id ON campaign_leads (user_id);
CREATE INDEX IF NOT EXISTS idx_campaign_leads_status ON campaign_leads (status);

DROP TRIGGER IF EXISTS set_campaign_leads_updated_at ON campaign_leads;
CREATE TRIGGER set_campaign_leads_updated_at
  BEFORE UPDATE ON campaign_leads
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ─── campaign_follow_ups (sequence / cadence per campaign) ────────────────

CREATE TABLE IF NOT EXISTS campaign_follow_ups (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id    UUID        NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,

  name           TEXT        NOT NULL,
  waiting_days   INT         NOT NULL CHECK (waiting_days >= 0 AND waiting_days <= 3650),
  body_template  TEXT,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_follow_ups_campaign_id ON campaign_follow_ups (campaign_id);

COMMENT ON COLUMN campaign_follow_ups.waiting_days IS
  'Calendar days after the initial campaign_leads.sent_at before this follow-up is due.';
COMMENT ON COLUMN campaign_follow_ups.body_template IS
  'Plain-text email template. Optional Subject: first line; supports {{firstName}}, {{fullName}}, {{email}}.';

DROP TRIGGER IF EXISTS set_campaign_follow_ups_updated_at ON campaign_follow_ups;
CREATE TRIGGER set_campaign_follow_ups_updated_at
  BEFORE UPDATE ON campaign_follow_ups
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ─── campaign_lead_follow_ups (per-lead follow-up send tracking) ───────────

CREATE TABLE IF NOT EXISTS campaign_lead_follow_ups (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_lead_id UUID        NOT NULL REFERENCES campaign_leads(id) ON DELETE CASCADE,
  follow_up_id     UUID        NOT NULL REFERENCES campaign_follow_ups(id) ON DELETE CASCADE,
  status           TEXT        NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'sent', 'failed')),
  sent_at          TIMESTAMPTZ,
  error_message    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_lead_id, follow_up_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_lead_follow_ups_campaign_lead_id
  ON campaign_lead_follow_ups (campaign_lead_id);
CREATE INDEX IF NOT EXISTS idx_campaign_lead_follow_ups_follow_up_id
  ON campaign_lead_follow_ups (follow_up_id);
CREATE INDEX IF NOT EXISTS idx_campaign_lead_follow_ups_status
  ON campaign_lead_follow_ups (status);

DROP TRIGGER IF EXISTS set_campaign_lead_follow_ups_updated_at ON campaign_lead_follow_ups;
CREATE TRIGGER set_campaign_lead_follow_ups_updated_at
  BEFORE UPDATE ON campaign_lead_follow_ups
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS meetings (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id        UUID        REFERENCES campaigns(id) ON DELETE SET NULL,
  campaign_lead_id   UUID        REFERENCES campaign_leads(id) ON DELETE SET NULL,

  title              TEXT        NOT NULL,
  description        TEXT,
  attendee_email     TEXT,
  start_at           TIMESTAMPTZ NOT NULL,
  end_at             TIMESTAMPTZ NOT NULL,

  google_event_id    TEXT,
  google_calendar_id TEXT        DEFAULT 'primary',
  meet_link          TEXT,

  status             TEXT        NOT NULL DEFAULT 'scheduled'
                       CHECK (status IN ('scheduled', 'cancelled', 'completed')),

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meetings_user_id ON meetings (user_id);
CREATE INDEX IF NOT EXISTS idx_meetings_campaign_id ON meetings (campaign_id);
CREATE INDEX IF NOT EXISTS idx_meetings_campaign_lead_id ON meetings (campaign_lead_id);
CREATE INDEX IF NOT EXISTS idx_meetings_start_at ON meetings (start_at);
CREATE INDEX IF NOT EXISTS idx_meetings_status ON meetings (status);

DROP TRIGGER IF EXISTS set_meetings_updated_at ON meetings;
CREATE TRIGGER set_meetings_updated_at
  BEFORE UPDATE ON meetings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ─── Notifications (in-app web) ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notifications (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  type              TEXT        NOT NULL,
  title             TEXT        NOT NULL,
  body              TEXT,

  read              BOOLEAN     NOT NULL DEFAULT false,
  read_at           TIMESTAMPTZ,

  campaign_id       UUID        REFERENCES campaigns(id) ON DELETE SET NULL,
  campaign_lead_id  UUID        REFERENCES campaign_leads(id) ON DELETE SET NULL,
  meeting_id        UUID        REFERENCES meetings(id) ON DELETE SET NULL,

  metadata          JSONB       NOT NULL DEFAULT '{}'::jsonb,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications (user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications (user_id, read, created_at DESC)
  WHERE read = false;
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications (created_at DESC);

-- ─── FCM web push tokens ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_fcm_tokens (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fcm_token     TEXT        NOT NULL,
  device_label  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (user_id, fcm_token)
);

CREATE INDEX IF NOT EXISTS idx_user_fcm_tokens_user_id ON user_fcm_tokens (user_id);

DROP TRIGGER IF EXISTS set_user_fcm_tokens_updated_at ON user_fcm_tokens;
CREATE TRIGGER set_user_fcm_tokens_updated_at
  BEFORE UPDATE ON user_fcm_tokens
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE user_fcm_tokens IS 'FCM registration tokens for web push per user/device.';

