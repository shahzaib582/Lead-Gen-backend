-- Optional sender metadata + ensure lead_source exists on campaigns (Supabase / Postgres).
-- Run against your project DB if these columns are not already present.

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS lead_source TEXT DEFAULT 'both'
    CHECK (lead_source IS NULL OR lead_source IN ('new', 'old', 'both'));

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS sender_display_name TEXT,
  ADD COLUMN IF NOT EXISTS sender_reply_to TEXT,
  ADD COLUMN IF NOT EXISTS sender_address TEXT,
  ADD COLUMN IF NOT EXISTS sender_phone TEXT;

COMMENT ON COLUMN campaigns.sender_reply_to IS 'Optional Reply-To header for Gmail MIME (must be a valid email if set).';
COMMENT ON COLUMN campaigns.sender_display_name IS 'Optional display name paired with Google account email for From header.';
