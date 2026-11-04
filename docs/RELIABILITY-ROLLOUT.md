# Reliability changes and rollout

Apply these SQL files as the database owner before starting the updated API or workers:

1. `sql/migrations/20261104_lead_pool_baseline.sql` (creates absent pool/enrichment tables; does not alter existing imports).
2. `sql/migrations/20261104_leads_data_sequence.sql` (locks the pool briefly and advances its existing identity/serial sequence; fails explicitly if no database-owned sequence exists).
3. `sql/migrations/20261104_delivery_reliability.sql` (delivery ledger, quota reservation and retryable Stripe inbox).

For a new Supabase database, `sql/schema.sql` includes the baseline tables and reliability functions. Existing databases still need migrations. Pause API traffic and all workers for the delivery migration so its backfill does not race with old senders. Restart every process together; do not mix old/new mailers. Back up first using your normal database procedure.

The database functions are executable only by `service_role`. The application requires that role, as before. No new secrets are needed.

## Behavior changes

- Initial sends and follow-ups share a database delivery ledger and an atomic 500-per-user UTC-day quota. Sending and uncertain records reserve quota; definite provider rejections release it. Existing sent rows are backfilled.
- Gmail automatic HTTP retries are disabled. Timeout/network/server errors remain blocked for reconciliation instead of automatically sending a second email. A definitive 4xx rejection can be retried.
- Confirmed Gmail results are saved before campaign state. If the second write fails, retry recovers that result without resending.
- Manual runs return a durable `jobId`; repeated active requests share the same BullMQ job. The existing campaign mail worker handles these jobs. Quota-exhausted runs resume after UTC midnight.
- Auto campaigns remain active while follow-ups are outstanding. Failed initial sends require attention. A periodic recovery job repairs pending template dispatch and restarts ready campaigns after crashes or activation.
- Queue kickoff checks are campaign-specific and serialized. The mail worker still uses concurrency 1 per worker process; recovery/manual work shares that queue. Dedicated workers are recommended for continuous processing; the existing single-process Render configuration remains a development/hobby option.
- Google identity-token login no longer creates or overwrites Gmail grants. Connect Gmail through the OAuth redirect. OAuth start/callback must run in the same browser with the HttpOnly state cookie. A frontend fetching `format=json` across origins must use `credentials: 'include'`, then navigate the browser to `authUrl`. Browser navigation to the redirect endpoint also works. The cookie is Secure in production.
- Stripe events are skipped only after successful processing. Failures are retried; an abandoned processing lease can be reclaimed after five minutes. Pre-migration event rows retain their historical processed status; audit previously failed billing changes separately.
- HTTP logs omit query strings to protect OAuth codes and SSE session IDs.

## Unconfirmed delivery procedure

Never delete/reset a ledger record merely to unblock sending. Query `outbound_deliveries` for `sending`/`uncertain` records, then inspect the connected Gmail Sent folder for the recipient and time. If sent, populate `result` with `messageId` and `threadId`, set `status='sent'`, and retry the corresponding campaign operation to repair its state. If you cannot establish whether Gmail accepted it, leave it blocked. Set `failed` only after establishing that no message was sent. There is intentionally no automatic expiry for ambiguous send claims.

Previously completed campaigns with outstanding follow-ups need an explicit review/reactivation; this update does not reactivate historical campaigns automatically.

## Verification

`npm test` and `npm run lint` run without sending emails or calling payment services. Targeted tests exercise concurrent delivery calls, unknown Gmail outcomes, persistence failures, campaign isolation/completion, OAuth replay/browser binding, credential preservation, Stripe recovery, durable manual jobs, pagination and bigint IDs.

`scripts/verify-delivery-db.py` runs real concurrent PostgreSQL checks against a disposable local database on `/tmp:55439`, never `.env`. Apply the schema to that isolated database first. It tests same-message exclusivity, quota contention, confirmed-result recovery, ambiguous send blocking and webhook leases, then removes generated fixtures.

## Remaining product work

Automatic assignment still uses the shared lead pool rather than a business-specific ICP. Targeting needs structured geography/industry/role inputs before changing selection semantics; `target_zone` currently accepts free-form text. User-specific Apollo/Hunter credit budgets, private lead collections, managed sender infrastructure and autonomous optimization remain separate product work. Existing tests do not replace a staging run against real Gmail, Calendly and Stripe test mode.
