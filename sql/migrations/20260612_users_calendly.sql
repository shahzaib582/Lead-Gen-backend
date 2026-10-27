-- User Calendly scheduling link (injected into thank-you Gmail drafts).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS calendly_url TEXT;

COMMENT ON COLUMN users.calendly_url IS
  'HTTPS Calendly booking URL (e.g. https://calendly.com/you/30min). Used in reply drafts.';

-- Link Calendly bookings to product meetings (webhook-created).
ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS calendly_invitee_uri TEXT,
  ADD COLUMN IF NOT EXISTS calendly_scheduled_event_uri TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_meetings_calendly_invitee_uri
  ON meetings (calendly_invitee_uri)
  WHERE calendly_invitee_uri IS NOT NULL;

COMMENT ON COLUMN meetings.calendly_invitee_uri IS
  'Calendly invitee resource URI; dedupes webhook deliveries.';

-- Idempotent Calendly webhook processing.
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
