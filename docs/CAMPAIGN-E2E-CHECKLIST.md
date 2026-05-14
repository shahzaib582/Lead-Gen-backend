# Campaign flows — manual E2E checklist

Use this in staging or local against a real Supabase project, Redis, and a test Google account.

## Prerequisites

1. **Env** (see `env.example`): `SUPABASE_*`, `JWT_*`, `REDIS_HOST` / `REDIS_PORT` or `REDIS_URL`, `OPENAI_API_KEY` (for templates), Google OAuth vars, optional `MAIL_DELAY_MIN_MS` / `MAIL_DELAY_MAX_MS`, optional `CAMPAIGN_ACTIVE_CREATE_AUTO_ASSIGN`.
2. **DB**: apply `sql/campaign_sender_fields.sql` (and existing schema migrations) so `campaigns` has `lead_source` and optional sender columns.
3. **Processes**: API (`npm run dev` or `node src/index.js`), **mail-template** worker, **campaign-mail** worker (BullMQ). On Render: web + both workers + Redis per `render.yaml`.

## Ordered steps

1. **Auth** — Register/login, verify email if required; obtain Bearer access token.
2. **Link Google** — Complete `GET /api/auth/google` flow so `google_accounts` has a row for the user.
3. **Create campaign** — `POST /api/campaigns` with required fields; default `draft`. Optionally set `sender_reply_to`, `sender_display_name`, `sender_address`, `sender_phone` and confirm they persist on `GET /api/campaigns/:id`.
4. **Assign leads** — `POST /api/campaigns/:id/leads/assign-random` or `assign-filtered` (confirm assign-filtered respects campaign `lead_source` with `new` / `old` / `both`).
5. **Activate** — `PATCH /api/campaigns/:id` with `{ "status": "active" }`. Confirm API logs / DB: pending leads with empty `mail_template` get template jobs (BullMQ / worker logs).
6. **Optional auto-assign on create** — With `CAMPAIGN_ACTIVE_CREATE_AUTO_ASSIGN=1`, create a campaign with `status: active` and `target_leads > 0`; confirm `data.autoAssign` (or assigned rows) without a separate assign call.
7. **Templates** — Wait for template worker; `campaign_leads.status` moves to `template_generated` where appropriate.
8. **SSE** — `POST /api/campaigns/:id/events/session` with Bearer; open `GET /api/campaigns/:id/events?sid=...` (curl or browser). Expect initial `campaign_progress`, then `template_*` / `mail_*` events as workers run; `: ping` comments ~15s.
9. **Send** — Kick off mail worker chain or `POST /api/campaigns/:id/leads/send-emails`. Confirm inter-send delay feels like minutes unless env overrides. Inspect Gmail for optional **Reply-To** / **From** display name / signature block.
10. **Google errors** — With Google disconnected or bad refresh token, confirm structured `googleError` / `fatalCode` in HTTP summary and worker logs without token leakage.

## Render notes

Web and workers are **separate** services; SSE uses **Redis pub/sub** shared with BullMQ. Web must reach the same Redis as workers (`REDIS_HOST` / `REDIS_PORT` from the Render Redis add-on, or `REDIS_URL` if you configure it).
