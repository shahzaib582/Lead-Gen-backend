-- FCM device tokens for web push (one row per browser/device token).

CREATE TABLE IF NOT EXISTS user_fcm_tokens (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fcm_token     TEXT        NOT NULL,
  device_label  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (user_id, fcm_token)
);

CREATE INDEX IF NOT EXISTS idx_user_fcm_tokens_user_id ON user_fcm_tokens (user_id);

DROP TRIGGER IF EXISTS set_user_fcm_tokens_updated_at ON user_fcm_tokens;
CREATE TRIGGER set_user_fcm_tokens_updated_at
  BEFORE UPDATE ON user_fcm_tokens
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE user_fcm_tokens IS 'FCM registration tokens for web push per user/device.';
