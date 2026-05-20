-- One-time thank-you reply draft in Gmail (not auto-sent; user reviews in Gmail).

ALTER TABLE campaign_leads
  ADD COLUMN IF NOT EXISTS thank_you_draft_gmail_id TEXT,
  ADD COLUMN IF NOT EXISTS thank_you_draft_created_at TIMESTAMPTZ;

COMMENT ON COLUMN campaign_leads.thank_you_draft_gmail_id IS
  'Gmail draft id for auto-created thank-you reply. Set once; never recreated.';
COMMENT ON COLUMN campaign_leads.thank_you_draft_created_at IS
  'When the thank-you draft was created in Gmail.';
