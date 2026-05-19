-- Remote Supabase had campaigns_lead_source_check allowing only 'new' and 'both'.
-- API + sql/schema.sql expect: new | old | both

ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_lead_source_check;

ALTER TABLE campaigns
  ADD CONSTRAINT campaigns_lead_source_check
  CHECK (lead_source IN ('new', 'old', 'both'));
