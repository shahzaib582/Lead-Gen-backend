-- =====================================================================
-- Lead Gen backend — Postgres / Supabase schema (single file).
--
-- Greenfield: run once on an empty database.
-- Existing DB: CREATE TABLE IF NOT EXISTS does not ALTER tables — add columns manually to match.
--
-- Includes the minimum shared lead pool and enrichment tables.
-- Existing imported tables are preserved; apply migrations to update existing installations.
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
  calendly_url    TEXT,
  notifications_enabled BOOLEAN NOT NULL DEFAULT true,
  deleted_at      TIMESTAMPTZ,

  stripe_customer_id TEXT,
  current_plan_id    TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN users.timezone IS
  'Optional IANA timezone for scheduling. When null, meetings use UTC.';

COMMENT ON COLUMN users.calendly_url IS
  'HTTPS Calendly booking URL. Injected into thank-you Gmail drafts as {{bookingLink}}.';

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

-- ─── calendly_accounts (OAuth per platform user) ───────────────────────────

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
  email_opened          BOOLEAN     NOT NULL DEFAULT false,
  email_opened_at       TIMESTAMPTZ,
  open_tracking_token   TEXT,
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

  calendly_invitee_uri          TEXT,
  calendly_scheduled_event_uri  TEXT,

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

CREATE UNIQUE INDEX IF NOT EXISTS idx_meetings_calendly_invitee_uri
  ON meetings (calendly_invitee_uri)
  WHERE calendly_invitee_uri IS NOT NULL;

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

-- ─── Billing (Stripe plans & subscriptions) ───────────────────────────────

CREATE TABLE IF NOT EXISTS plans (
  id                      TEXT        PRIMARY KEY,
  name                    TEXT        NOT NULL,
  price_cents             INT         NOT NULL DEFAULT 0,
  currency                TEXT        NOT NULL DEFAULT 'usd',
  billing_interval        TEXT        NOT NULL DEFAULT 'month',
  max_campaigns           INT         NOT NULL,
  max_leads_per_campaign  INT         NOT NULL,
  stripe_product_id       TEXT,
  stripe_price_id         TEXT,
  is_active               BOOLEAN     NOT NULL DEFAULT true,
  sort_order              INT         NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO plans (id, name, price_cents, max_campaigns, max_leads_per_campaign, sort_order)
VALUES
  ('starter', 'Starter', 0, 5, 100, 1),
  ('growth', 'Growth', 5000, 15, 500, 2),
  ('pro', 'Pro', 10000, 30, 1000, 3)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_current_plan' AND conrelid = 'public.users'::regclass) THEN
    ALTER TABLE users
  ADD CONSTRAINT fk_users_current_plan
  FOREIGN KEY (current_plan_id) REFERENCES plans(id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_stripe_customer_id
  ON users (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_subscriptions (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id                 TEXT        NOT NULL REFERENCES plans(id),
  status                  TEXT        NOT NULL DEFAULT 'active'
                            CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'incomplete', 'unpaid')),
  stripe_subscription_id  TEXT,
  stripe_price_id         TEXT,
  current_period_start    TIMESTAMPTZ,
  current_period_end      TIMESTAMPTZ,
  cancel_at_period_end    BOOLEAN     NOT NULL DEFAULT false,
  canceled_at             TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id TEXT        NOT NULL UNIQUE,
  type            TEXT        NOT NULL,
  payload         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  processed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS calendly_webhook_events (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key   TEXT        NOT NULL UNIQUE,
  event_type   TEXT        NOT NULL,
  invitee_uri  TEXT,
  payload      JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calendly_webhook_events_created_at
  ON calendly_webhook_events (created_at);

DROP TRIGGER IF EXISTS set_plans_updated_at ON plans;
CREATE TRIGGER set_plans_updated_at
  BEFORE UPDATE ON plans
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_user_subscriptions_updated_at ON user_subscriptions;
CREATE TRIGGER set_user_subscriptions_updated_at
  BEFORE UPDATE ON user_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();


-- Lead pool baseline
-- Minimum lead-pool and enrichment tables used by this repository. Existing imports are preserved.
CREATE TABLE IF NOT EXISTS leads_data (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  "firstName" TEXT,
  "lastName" TEXT,
  "fullName" TEXT,
  "title" TEXT,
  "seniority" TEXT,
  "department" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "linkedin" TEXT,
  "city" TEXT,
  "state" TEXT,
  "country" TEXT,
  "timezone" TEXT,
  "company" TEXT,
  "domain" TEXT,
  "companyLinkedin" TEXT,
  "industry" TEXT,
  "subIndustry" TEXT,
  "employees" TEXT,
  "revenue" TEXT,
  "companyHeadquarters" TEXT,
  "companyDescription" TEXT,
  "companyType" TEXT,
  "companyPhone" TEXT,
  "companyCity" TEXT,
  "compantyState" TEXT,
  "apolloPersonId" TEXT,
  "apolloCompanyId" TEXT,
  "leadType" TEXT,
  "fitTag" TEXT,
  "source" TEXT,
  "fitReason" TEXT,
  "notes" TEXT,
  "emailStatus" TEXT,
  "emailSource" TEXT,
  "dateAdded" TEXT,
  "outreachStatus" TEXT,
  "emailSent" TEXT,
  "emailSentDate" TEXT,
  "fitScore" NUMERIC,
  technologies JSONB,
  metadata JSONB
);
CREATE INDEX IF NOT EXISTS idx_leads_data_email ON leads_data(email);
CREATE INDEX IF NOT EXISTS idx_leads_data_linkedin ON leads_data(linkedin);
CREATE TABLE IF NOT EXISTS linkedinscrapping (
 id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
 linkedin_url TEXT, headline TEXT, summary TEXT, location TEXT,
 follower_count BIGINT, connections_count BIGINT, current_company TEXT, experience JSONB
);
CREATE INDEX IF NOT EXISTS idx_linkedinscrapping_url ON linkedinscrapping(linkedin_url);
CREATE TABLE IF NOT EXISTS webscrapping (
 id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, domain TEXT, llmresponse TEXT
);
CREATE INDEX IF NOT EXISTS idx_webscrapping_domain ON webscrapping(domain);

-- Durable delivery and webhook coordination
-- Apply before deploying the corresponding application changes. Run as database owner.
BEGIN;

CREATE TABLE IF NOT EXISTS outbound_deliveries (
  delivery_key TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'failed', 'uncertain')),
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  result JSONB,
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_outbound_deliveries_user_day
  ON outbound_deliveries (user_id, attempted_at) WHERE status <> 'failed';
ALTER TABLE outbound_deliveries ENABLE ROW LEVEL SECURITY;

-- Preserve quota usage and duplicate protection for previously delivered messages.
INSERT INTO outbound_deliveries (delivery_key, user_id, status, attempted_at, result)
SELECT 'initial-' || id, user_id, 'sent', sent_at,
  jsonb_build_object('messageId', gmail_message_id, 'threadId', gmail_thread_id,
                     'openTrackingToken', open_tracking_token)
FROM campaign_leads WHERE status = 'sent' AND sent_at IS NOT NULL
ON CONFLICT DO NOTHING;
INSERT INTO outbound_deliveries (delivery_key, user_id, status, attempted_at, result)
SELECT 'followup-' || f.campaign_lead_id || '-' || f.follow_up_id, l.user_id,
       'sent', f.sent_at, '{}'::jsonb
FROM campaign_lead_follow_ups f JOIN campaign_leads l ON l.id = f.campaign_lead_id
WHERE f.status = 'sent' AND f.sent_at IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION claim_outbound_delivery(p_key TEXT, p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE existing outbound_deliveries; used BIGINT;
BEGIN
  -- Serialize all quota reservations for a user across workers, HTTP and follow-ups.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  SELECT * INTO existing FROM outbound_deliveries WHERE delivery_key = p_key;
  IF FOUND AND existing.user_id <> p_user_id THEN
    RAISE EXCEPTION 'Delivery owner mismatch';
  END IF;
  IF existing.status = 'sent' THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'already_sent',
                             'result', existing.result, 'sentAt', existing.attempted_at);
  END IF;
  -- An interrupted or ambiguous Gmail call requires reconciliation, never an automatic resend.
  IF existing.status IN ('sending', 'uncertain') THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'delivery_unconfirmed');
  END IF;
  SELECT count(*) INTO used FROM outbound_deliveries
    WHERE user_id = p_user_id AND status <> 'failed'
      AND attempted_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  IF used >= 500 THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'daily_limit_reached');
  END IF;
  INSERT INTO outbound_deliveries (delivery_key, user_id, status)
    VALUES (p_key, p_user_id, 'sending')
    ON CONFLICT (delivery_key) DO UPDATE
      SET status = 'sending', attempted_at = now(), result = NULL, error_message = NULL;
  RETURN jsonb_build_object('claimed', true);
END;
$$;
REVOKE ALL ON FUNCTION claim_outbound_delivery(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_outbound_delivery(TEXT, UUID) TO service_role;

ALTER TABLE stripe_webhook_events ALTER COLUMN processed_at DROP NOT NULL;
ALTER TABLE stripe_webhook_events ALTER COLUMN processed_at DROP DEFAULT;
ALTER TABLE stripe_webhook_events ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;
ALTER TABLE stripe_webhook_events ADD COLUMN IF NOT EXISTS processing_token UUID;
ALTER TABLE stripe_webhook_events ADD COLUMN IF NOT EXISTS error_message TEXT;

CREATE OR REPLACE FUNCTION claim_stripe_webhook(p_event JSONB, p_token UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE event_row stripe_webhook_events;
BEGIN
  INSERT INTO stripe_webhook_events (stripe_event_id, type, payload, processed_at)
    VALUES (p_event->>'id', p_event->>'type', p_event, NULL) ON CONFLICT DO NOTHING;
  SELECT * INTO event_row FROM stripe_webhook_events
    WHERE stripe_event_id = p_event->>'id' FOR UPDATE;
  IF event_row.processed_at IS NOT NULL THEN RETURN 'processed'; END IF;
  IF event_row.processing_started_at > now() - interval '5 minutes' THEN RETURN 'busy'; END IF;
  UPDATE stripe_webhook_events SET processing_started_at = now(), processing_token = p_token,
    error_message = NULL WHERE stripe_event_id = p_event->>'id';
  RETURN 'claimed';
END;
$$;
REVOKE ALL ON FUNCTION claim_stripe_webhook(JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_stripe_webhook(JSONB, UUID) TO service_role;
COMMIT;
