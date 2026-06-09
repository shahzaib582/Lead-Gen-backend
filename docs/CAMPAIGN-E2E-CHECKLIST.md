# Campaign flows — manual E2E checklist

Use this in staging or local against a real Supabase project, Redis, and a test Google account.

## Prerequisites

1. **Env** (see `env.example`): `SUPABASE_*`, `JWT_*`, `REDIS_HOST` / `REDIS_PORT` or `REDIS_URL`, `OPENAI_API_KEY` (for templates), Google OAuth vars, optional `MAIL_DELAY_MIN_MS` / `MAIL_DELAY_MAX_MS`, optional `CAMPAIGN_ACTIVE_CREATE_AUTO_ASSIGN`.
2. **DB**: ensure `campaigns` matches `sql/schema.sql` (`lead_source`, sender columns, `mail_training_instruction`, `mail_template_samples`, `target_tone`). For legacy DBs, ALTER to match that file (see commented migration at the bottom of `sql/schema.sql`).
3. **Processes**: API (`npm run dev` or `node src/index.js`), **mail-template** worker, **campaign-mail** worker, **follow-up-scheduler** worker (BullMQ). On Render: web + all workers + Redis per `render.yaml`.

## Ordered steps

1. **Auth** — Register/login, verify email if required; obtain Bearer access token.
2. **Link Google** — Complete `GET /api/auth/google` flow so `google_accounts` has a row for the user.
3. **Create campaign** — `POST /api/campaigns` with required fields; default `draft`. Optionally set `mail_training_instruction`, `mail_template_samples` (array of `{ subject?, body?, html?, text? }`), `sender_display_name`, `sender_address`, `sender_phone` and confirm they persist on `GET /api/campaigns/:id`.
4. **Assign leads** — After campaign is `active`, `paused`, or `completed` (not `draft`), `POST /api/campaigns/:id/leads/bulk` with `{ "leads": [{ "lead_data_id": "..." }] }`. Or enable `CAMPAIGN_ACTIVE_CREATE_AUTO_ASSIGN` on create with `status: active` and `target_leads > 0`.
5. **Activate** — `PATCH /api/campaigns/:id` with `{ "status": "active" }`. Confirm API logs / DB: pending leads with empty `mail_template` get template jobs (BullMQ / worker logs).
6. **Optional auto-assign on create** — With `CAMPAIGN_ACTIVE_CREATE_AUTO_ASSIGN=1`, create a campaign with `status: active` and `target_leads > 0`; confirm `data.autoAssign` (or assigned rows) without a separate assign call.
7. **Templates** — Wait for template worker; `campaign_leads.status` moves to `template_generated` where appropriate.
8. **SSE** — `POST /api/campaigns/:id/events/session` with Bearer; open `GET /api/campaigns/:id/events?sid=...` (curl or browser). Expect initial `campaign_progress`, then `template_*` / `mail_*` events as workers run; `: ping` comments ~15s.
9. **Send** — Kick off mail worker chain or `POST /api/campaigns/:id/leads/send-emails`. Confirm inter-send delay feels like minutes unless env overrides. Inspect Gmail for optional **From** display name (linked owner Gmail) and signature block.
10. **Google errors** — With Google disconnected or bad refresh token, confirm structured `googleError` / `fatalCode` in HTTP summary and worker logs without token leakage.
11. **Follow-ups** — Run SQL migration for `campaign_follow_ups.body_template` and `campaign_lead_follow_ups` (see `sql/schema.sql`). Create follow-ups via `POST /api/campaigns/:id/follow-ups` with `name`, `waiting_days`, and plain-text `body_template` (optional `Subject:` first line; `{{firstName}}`, `{{fullName}}`, `{{email}}`). After initial emails are `sent` with `sent_at`, start **follow-up-scheduler** worker (or `RUN_WORKERS_IN_WEB=1`). Scheduler runs every 6 hours (`FOLLOW_UP_CRON`, default `0 */6 * * *`), sends due follow-ups for **active** campaigns only (due = `sent_at` + `waiting_days` calendar days). Confirm rows in `campaign_lead_follow_ups` with `status=sent` and no duplicate sends on rerun.

## Render notes

Web and workers are **separate** services; SSE uses **Redis pub/sub** shared with BullMQ. Web must reach the same Redis as workers (`REDIS_HOST` / `REDIS_PORT` from the Render Redis add-on, or `REDIS_URL` if you configure it).
