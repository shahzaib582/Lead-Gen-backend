-- Gmail threading + skip follow-ups when lead replied

ALTER TABLE campaign_leads
  ADD COLUMN IF NOT EXISTS gmail_thread_id TEXT,
  ADD COLUMN IF NOT EXISTS gmail_message_id TEXT,
  ADD COLUMN IF NOT EXISTS gmail_subject TEXT,
  ADD COLUMN IF NOT EXISTS gmail_rfc_message_id TEXT,
  ADD COLUMN IF NOT EXISTS reply_received BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reply_received_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_campaign_leads_reply_received
  ON campaign_leads (campaign_id, reply_received)
  WHERE status = 'sent';

COMMENT ON COLUMN campaign_leads.gmail_thread_id IS 'Gmail threadId from initial outbound send; used for threaded follow-ups.';
COMMENT ON COLUMN campaign_leads.gmail_message_id IS 'Gmail API message id of the initial outbound send.';
COMMENT ON COLUMN campaign_leads.gmail_rfc_message_id IS 'RFC Message-ID header of initial send for In-Reply-To / References.';
COMMENT ON COLUMN campaign_leads.reply_received IS 'When true, follow-up emails are skipped for this lead.';
