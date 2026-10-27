-- Email open tracking via 1×1 pixel token on outbound campaign emails

ALTER TABLE campaign_leads
  ADD COLUMN IF NOT EXISTS email_opened BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_opened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS open_tracking_token TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_leads_open_tracking_token
  ON campaign_leads (open_tracking_token)
  WHERE open_tracking_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_campaign_leads_email_opened
  ON campaign_leads (campaign_id, email_opened)
  WHERE status = 'sent';

COMMENT ON COLUMN campaign_leads.open_tracking_token IS 'Opaque token embedded in open-tracking pixel URL for this lead send.';
COMMENT ON COLUMN campaign_leads.email_opened IS 'True when the lead loaded the tracking pixel at least once.';
COMMENT ON COLUMN campaign_leads.email_opened_at IS 'UTC timestamp of the first open event.';
