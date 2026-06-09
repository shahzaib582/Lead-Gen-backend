-- Optional IANA timezone on user profile (e.g. America/New_York). Used for calendar events when set.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS timezone TEXT;

COMMENT ON COLUMN users.timezone IS
  'Optional IANA timezone for scheduling. When null, meetings use UTC.';

-- Product meetings only (not personal Google Calendar events). Dashboard counts use this table.
CREATE TABLE IF NOT EXISTS meetings (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id       UUID        REFERENCES campaigns(id) ON DELETE SET NULL,
  campaign_lead_id  UUID        REFERENCES campaign_leads(id) ON DELETE SET NULL,

  title             TEXT        NOT NULL,
  description       TEXT,
  attendee_email    TEXT,
  start_at          TIMESTAMPTZ NOT NULL,
  end_at            TIMESTAMPTZ NOT NULL,

  google_event_id   TEXT,
  google_calendar_id TEXT       DEFAULT 'primary',
  meet_link         TEXT,

  status            TEXT        NOT NULL DEFAULT 'scheduled'
                      CHECK (status IN ('scheduled', 'cancelled', 'completed')),

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

COMMENT ON TABLE meetings IS
  'Lead Gen–booked meetings only. Counts and dashboard metrics use this table, not raw Google Calendar.';
