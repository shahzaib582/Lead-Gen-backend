-- Apply before deploying the corresponding application changes. Run as database owner.
BEGIN;

CREATE TABLE IF NOT EXISTS outbound_deliveries (
  delivery_key TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'failed', 'uncertain')),
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  result JSONB,
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_outbound_deliveries_user_day
  ON outbound_deliveries (user_id, attempted_at) WHERE status <> 'failed';
ALTER TABLE outbound_deliveries ENABLE ROW LEVEL SECURITY;

-- Preserve quota usage and duplicate protection for previously delivered messages.
INSERT INTO outbound_deliveries (delivery_key, user_id, status, attempted_at, result)
SELECT 'initial-' || id, user_id, 'sent', sent_at,
  jsonb_build_object('messageId', gmail_message_id, 'threadId', gmail_thread_id,
                     'openTrackingToken', open_tracking_token)
FROM campaign_leads WHERE status = 'sent' AND sent_at IS NOT NULL
ON CONFLICT DO NOTHING;
INSERT INTO outbound_deliveries (delivery_key, user_id, status, attempted_at, result)
SELECT 'followup-' || f.campaign_lead_id || '-' || f.follow_up_id, l.user_id,
       'sent', f.sent_at, '{}'::jsonb
FROM campaign_lead_follow_ups f JOIN campaign_leads l ON l.id = f.campaign_lead_id
WHERE f.status = 'sent' AND f.sent_at IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION claim_outbound_delivery(p_key TEXT, p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE existing outbound_deliveries; used BIGINT;
BEGIN
  -- Serialize all quota reservations for a user across workers, HTTP and follow-ups.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  SELECT * INTO existing FROM outbound_deliveries WHERE delivery_key = p_key;
  IF FOUND AND existing.user_id <> p_user_id THEN
    RAISE EXCEPTION 'Delivery owner mismatch';
  END IF;
  IF existing.status = 'sent' THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'already_sent',
                             'result', existing.result, 'sentAt', existing.attempted_at);
  END IF;
  -- An interrupted or ambiguous Gmail call requires reconciliation, never an automatic resend.
  IF existing.status IN ('sending', 'uncertain') THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'delivery_unconfirmed');
  END IF;
  SELECT count(*) INTO used FROM outbound_deliveries
    WHERE user_id = p_user_id AND status <> 'failed'
      AND attempted_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  IF used >= 500 THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'daily_limit_reached');
  END IF;
  INSERT INTO outbound_deliveries (delivery_key, user_id, status)
    VALUES (p_key, p_user_id, 'sending')
    ON CONFLICT (delivery_key) DO UPDATE
      SET status = 'sending', attempted_at = now(), result = NULL, error_message = NULL;
  RETURN jsonb_build_object('claimed', true);
END;
$$;
REVOKE ALL ON FUNCTION claim_outbound_delivery(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_outbound_delivery(TEXT, UUID) TO service_role;

ALTER TABLE stripe_webhook_events ALTER COLUMN processed_at DROP NOT NULL;
ALTER TABLE stripe_webhook_events ALTER COLUMN processed_at DROP DEFAULT;
ALTER TABLE stripe_webhook_events ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;
ALTER TABLE stripe_webhook_events ADD COLUMN IF NOT EXISTS processing_token UUID;
ALTER TABLE stripe_webhook_events ADD COLUMN IF NOT EXISTS error_message TEXT;

CREATE OR REPLACE FUNCTION claim_stripe_webhook(p_event JSONB, p_token UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE event_row stripe_webhook_events;
BEGIN
  INSERT INTO stripe_webhook_events (stripe_event_id, type, payload, processed_at)
    VALUES (p_event->>'id', p_event->>'type', p_event, NULL) ON CONFLICT DO NOTHING;
  SELECT * INTO event_row FROM stripe_webhook_events
    WHERE stripe_event_id = p_event->>'id' FOR UPDATE;
  IF event_row.processed_at IS NOT NULL THEN RETURN 'processed'; END IF;
  IF event_row.processing_started_at > now() - interval '5 minutes' THEN RETURN 'busy'; END IF;
  UPDATE stripe_webhook_events SET processing_started_at = now(), processing_token = p_token,
    error_message = NULL WHERE stripe_event_id = p_event->>'id';
  RETURN 'claimed';
END;
$$;
REVOKE ALL ON FUNCTION claim_stripe_webhook(JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_stripe_webhook(JSONB, UUID) TO service_role;
COMMIT;
