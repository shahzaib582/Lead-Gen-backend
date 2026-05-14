-- Remove legacy sender_reply_to (replies use campaign owner's linked Gmail; no separate Reply-To).
ALTER TABLE campaigns DROP COLUMN IF EXISTS sender_reply_to;
