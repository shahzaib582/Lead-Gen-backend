-- Apollo / Hunter pipeline fields on the shared leads pool.
-- leads_data uses quoted camelCase columns (e.g. "firstName"). Do not unquote them.

ALTER TABLE leads_data
  ADD COLUMN IF NOT EXISTS "phone" TEXT,
  ADD COLUMN IF NOT EXISTS "timezone" TEXT,
  ADD COLUMN IF NOT EXISTS "companyLinkedin" TEXT,
  ADD COLUMN IF NOT EXISTS "subIndustry" TEXT,
  ADD COLUMN IF NOT EXISTS "companyDescription" TEXT,
  ADD COLUMN IF NOT EXISTS "companyType" TEXT,
  ADD COLUMN IF NOT EXISTS "companyHeadquarters" TEXT,
  ADD COLUMN IF NOT EXISTS "apolloPersonId" TEXT,
  ADD COLUMN IF NOT EXISTS "apolloCompanyId" TEXT,
  ADD COLUMN IF NOT EXISTS "leadType" TEXT,
  ADD COLUMN IF NOT EXISTS "source" TEXT,
  ADD COLUMN IF NOT EXISTS "technologies" JSONB,
  ADD COLUMN IF NOT EXISTS "metadata" JSONB;

CREATE INDEX IF NOT EXISTS idx_leads_data_apollo_person_id
  ON leads_data ("apolloPersonId")
  WHERE "apolloPersonId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_data_source
  ON leads_data ("source")
  WHERE "source" IS NOT NULL;

COMMENT ON COLUMN leads_data."phone" IS 'Person phone from Apollo (sanitized when available).';
COMMENT ON COLUMN leads_data."companyPhone" IS 'Company phone; pipeline also copies person phone when company phone is missing.';
COMMENT ON COLUMN leads_data."companyLinkedin" IS 'Company LinkedIn URL from Apollo organization.';
COMMENT ON COLUMN leads_data."apolloPersonId" IS 'Apollo person id used for pool dedupe.';
COMMENT ON COLUMN leads_data."source" IS 'Lead origin (e.g. apollo). Not campaign_leads.';
COMMENT ON COLUMN leads_data."metadata" IS 'Verification + Apollo extras (verified_by, headline, match confidence).';
COMMENT ON COLUMN leads_data."leadType" IS 'Pipeline lead type (VOLUME, HIGH_TICKET, STRATEGIC_PARTNER, ...).';
