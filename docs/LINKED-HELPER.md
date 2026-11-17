# Linked Helper integration

Backend integration for enrolling existing campaign leads in a configured Linked Helper workflow. This is separate from Gmail: existing email run/activation routes still run email outreach. No subscription is purchased and no real leads are contacted by installing this change.

## Deployment

1. Apply `sql/migrations/20261114_linked_helper.sql` in Supabase before deploying the backend. Both new tables have RLS enabled with no client access policies; only the backend service role accesses them.
2. Generate a key using `openssl rand -hex 32`, and set `LINKED_HELPER_ENCRYPTION_KEY` in the backend environment. Keep this key stable and private. Replacing it requires configuring every campaign webhook again.
3. Use Linked Helper **Cloud Storage**, create the desired invitation/message/follow-up workflow, and generate its incoming webhook under Workflow → Webhook. Enable **Stand by mode** so newly enrolled prospects are processed automatically. Keep Linked Helper running on a compatible computer/VPS, signed into the correct LinkedIn account.
4. Configure the webhook using the API below. Only HTTPS URLs on linkedhelper.com or its subdomains are accepted. If your actual vendor-generated URL uses another domain, verify it with the vendor before changing the allowlist. Redirects are blocked. The webhook URL is encrypted at rest and never returned by the API.
5. Use a test profile you control to verify the complete flow before enrolling clients' leads. Actual delivery and replies must currently be verified in Linked Helper.

## Authenticated API

All routes use the usual Bearer token, enforce campaign ownership, and are below `/api/campaigns/{campaignId}/linkedin`.

- `GET /configuration`: `{ configured, updated_at }` inside the normal success envelope.
- `PUT /configuration`: body `{ "webhook_url": "https://<vendor-host>/<secret-webhook>" }`.
- `POST /enroll`: body `{ "leads": [{ "campaign_lead_id": "<uuid>", "message": "Hello Jane, ..." }] }`. Up to 10 leads per request; message is optional (maximum 8,000 characters). Each existing campaign lead must reference a `leads_data` row with a valid HTTPS `linkedin.com/in/` URL. Sales Navigator URLs are currently rejected. Campaign ownership is checked for the entire batch before sending. Invalid LinkedIn profile URLs return a per-lead invalid result without blocking valid profiles.
- `GET /enrollments?page=1&limit=20`: paginated enrollment history with lead IDs and statuses (maximum page size 100).

Custom messages are passed as the `cs_message` custom field; insert that custom variable using Linked Helper's template editor in its message action. If you omit `message`, configure the Linked Helper workflow's own template. `cs_source` is `lead-gen`. Email HTML templates are never reused as LinkedIn messages.

The enroll endpoint sends the documented `{ payload: { people: [{ externalId, customFields }] } }` shape, one profile per request. It does not create or edit workflows or directly call LinkedIn's messaging API. Configure invitation and follow-up timing, stop-on-reply rules, and limits in Linked Helper.

## Results and recovery

- `accepted`: the provider returned HTTP 2xx for enrollment; this does **not** confirm an invitation or message was sent.
- `rejected`: the provider returned HTTP 4xx; inspect configuration/limits in Linked Helper.
- `uncertain`: a network error or server failure prevents confirming enrollment.
- `submitting`: durable claim exists; a process interruption or failed status write may leave this state indefinitely. Treat it as uncertain.
- `already_submitted`: the campaign/profile pair was previously claimed. Inspect enrollment history for its stored state.

A unique database constraint on campaign/profile prevents concurrent or repeated enrollment. No automatic retries are made. To retry a definite rejection after correcting configuration, explicitly submit the lead again with retry_rejected set to true. The claim changes from rejected to submitting atomically, so concurrent retries cannot both enroll. Accepted, uncertain, and submitting claims cannot be reclaimed. HTTP 408 is treated as uncertain. Before any manual reset of an uncertain claim, confirm in Linked Helper that enrollment did not occur. Changing a webhook does not reset claims. Different campaigns can intentionally enroll the same profile. Cross-campaign contact suppression is not provided.

There is no automatic reply/delivery callback integration in this release: outgoing webhook mappings vary by Linked Helper workflow, and must be verified against a real payload before introducing sent/replied states. Enrollment history never changes Gmail status or marks the local campaign completed. The sibling sales-lead-automation-frontend repository provides a LinkedIn outreach panel in campaign details for webhook configuration, per-lead enrollment, and enrollment history. See its docs/LINKED-HELPER.md for usage and rollout requirements.

## References

- [Official incoming webhook schema and setup](https://support.linkedhelper.com/hc/en-us/articles/37041823852946-Incoming-webhooks)
- [Cloud Storage, standby mode, and custom message support](https://www.linkedhelper.com/features/incoming-webhooks)

Settings uses `GET /api/campaigns/linkedin-status` to show the authenticated user’s saved webhook count. This reports saved configuration only; it does not contact Linked Helper or verify live workflow connectivity.
