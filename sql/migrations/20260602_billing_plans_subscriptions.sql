-- Billing: plans, user subscriptions, Stripe customer on users

CREATE TABLE IF NOT EXISTS plans (
  id                      TEXT        PRIMARY KEY,
  name                    TEXT        NOT NULL,
  price_cents             INT         NOT NULL DEFAULT 0,
  currency                TEXT        NOT NULL DEFAULT 'usd',
  billing_interval        TEXT        NOT NULL DEFAULT 'month',
  max_campaigns           INT         NOT NULL,
  max_leads_per_campaign  INT         NOT NULL,
  stripe_product_id       TEXT,
  stripe_price_id         TEXT,
  is_active               BOOLEAN     NOT NULL DEFAULT true,
  sort_order              INT         NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO plans (id, name, price_cents, max_campaigns, max_leads_per_campaign, sort_order)
VALUES
  ('starter', 'Starter', 0, 5, 100, 1),
  ('growth', 'Growth', 5000, 15, 500, 2),
  ('pro', 'Pro', 10000, 30, 1000, 3)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS current_plan_id TEXT REFERENCES plans(id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_stripe_customer_id
  ON users (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_current_plan_id ON users (current_plan_id);

CREATE TABLE IF NOT EXISTS user_subscriptions (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id                 TEXT        NOT NULL REFERENCES plans(id),
  status                  TEXT        NOT NULL DEFAULT 'active'
                            CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'incomplete', 'unpaid')),
  stripe_subscription_id  TEXT,
  stripe_price_id         TEXT,
  current_period_start    TIMESTAMPTZ,
  current_period_end      TIMESTAMPTZ,
  cancel_at_period_end    BOOLEAN     NOT NULL DEFAULT false,
  canceled_at             TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_plan_id ON user_subscriptions (plan_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_stripe_sub
  ON user_subscriptions (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id TEXT        NOT NULL UNIQUE,
  type            TEXT        NOT NULL,
  payload         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  processed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_plans_updated_at ON plans;
CREATE TRIGGER set_plans_updated_at
  BEFORE UPDATE ON plans
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_user_subscriptions_updated_at ON user_subscriptions;
CREATE TRIGGER set_user_subscriptions_updated_at
  BEFORE UPDATE ON user_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
