-- User preference: in-app notifications on/off (default on).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN users.notifications_enabled IS
  'When false, notification rows are still saved; SSE and FCM push are not sent.';
