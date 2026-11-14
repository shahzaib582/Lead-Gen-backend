-- Service-role access only. LinkedIn enrollment is independent of Gmail delivery.
CREATE TABLE IF NOT EXISTS linked_helper_campaigns (
  campaign_id UUID PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  webhook_encrypted TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS linked_helper_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_lead_id UUID REFERENCES campaign_leads(id) ON DELETE SET NULL,
  profile_url TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('submitting','accepted','rejected','uncertain')),
  http_status INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, profile_url)
);
CREATE INDEX IF NOT EXISTS linked_helper_enrollments_campaign_created ON linked_helper_enrollments(campaign_id, created_at DESC);
ALTER TABLE linked_helper_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE linked_helper_enrollments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON linked_helper_campaigns, linked_helper_enrollments FROM anon, authenticated;
