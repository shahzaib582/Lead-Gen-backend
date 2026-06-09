-- In-app notifications for web (bell icon, list, real-time SSE).

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

COMMENT ON TABLE notifications IS 'User-scoped in-app notifications for the web UI.';
