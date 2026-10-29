# `lead-pipeline` Edge Function

The only edge function in this project.

```
Apollo search  ->  verify email  ->  save to campaign_leads (verified only)
```

## What it does, in order

1. Authenticates the caller (Supabase user token) and checks the campaign belongs to them
2. Validates `entity` + `category` against `_shared/client-categories.ts` and builds the Apollo search from that config
3. Searches Apollo (max 5 people per call) and enriches them
4. Scores each person 0-100 against the category (`_shared/scoring.ts`)
5. Drops duplicates in the batch and personal addresses (gmail, yahoo, ...)
6. Skips people already saved **and** verified (no credits spent again)
7. **Verifies the email**
   - Apollo `email_status = verified` passes with no extra credit
   - otherwise Hunter verifies it (`valid` passes; `risky`, `invalid`, `unknown` do not)
   - no email at all: Hunter finder, then Hunter verify
8. **Saves only verified leads** to `campaign_leads` with `email_verification_status = 'verified'`, plus `fit_score`, `fit_reason` and `metadata.verification` (who verified it and when)

Unverified leads are counted in `stats` and never written to the database.

## Request

```
POST /functions/v1/lead-pipeline
Authorization: Bearer <supabase user access token>
```

```jsonc
{
  "campaign_id": "uuid", // required, must belong to the caller
  "entity": "EQAIESPORTS", // required
  "category": "VENUE", // required, must belong to the entity
  "page": 1, // optional
  "per_page": 3, // optional, default 3, hard cap 5
  "locations": ["Arizona, United States"], // optional, overrides default geography
  "exclude_domains": ["rival.com"], // optional, added to the global blocklist
}
```

| entity           | categories                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| `EQAIESPORTS`    | `VENUE`, `EVENT_ORGANIZER`, `ACTIVATION_PARTNER`, `COLLEGIATE`, `TEAM_OR_STUDIO`, `ENTERPRISE_LICENSE` |
| `PITCH4CAPITAL`  | `INVESTOR`                                                                                             |
| `CEOSOCIAL`      | `CEO_FOUNDER`                                                                                          |
| `CPACLOUDTAXUSA` | `CPA_FIRM`, `SMB_TAX_CLIENT`                                                                           |

## Lead classes

Every saved lead carries a business class in `campaign_leads.lead_class`, set from the category that found it (`_shared/lead-classes.ts`, `_shared/client-categories.ts`):

| Class     | Label                   | Found through                                                   |
| --------- | ----------------------- | --------------------------------------------------------------- |
| `LEAD-01` | Consumer/Executive Lead | `CEOSOCIAL \| CEO_FOUNDER`, `CPACLOUDTAXUSA \| SMB_TAX_CLIENT`  |
| `LEAD-02` | Workshop Lead           | `EQAIESPORTS \| COLLEGIATE`                                     |
| `LEAD-03` | Activation Partner      | `EQAIESPORTS \| VENUE`, `EVENT_ORGANIZER`, `ACTIVATION_PARTNER` |
| `LEAD-04` | Strategic Partner       | `EQAIESPORTS \| TEAM_OR_STUDIO`, `CPACLOUDTAXUSA \| CPA_FIRM`   |
| `LEAD-05` | Enterprise Lead         | `EQAIESPORTS \| ENTERPRISE_LICENSE`                             |
| `LEAD-06` | Capital Lead            | `PITCH4CAPITAL \| INVESTOR`                                     |

`lead_class` (what the lead is), `lead_type` (outreach workflow tag) and `target_segment` (the exact search) are separate fields. To change which class a category produces, edit `lead_class` on that category in `client-categories.ts`; the tests fail if any class has no category or any category has no class.

## Response (200)

```jsonc
{
  "success": true,
  "campaign_id": "uuid",
  "entity": "EQAIESPORTS",
  "category": "VENUE",
  "target_segment": "EQAIESPORTS | VENUE",
  "lead_type": "CO_EVENT_COLLABORATOR",
  "lead_class": "LEAD-03",
  "lead_class_label": "Activation Partner",
  "requested": 3,
  "found": 3, // people Apollo returned
  "saved": 2, // inserted + updated, all verified
  "inserted": 1,
  "updated": 1,
  "already_verified": 0, // already in the table and verified, returned as-is
  "stats": {
    "verified_by_apollo": 1,
    "verified_by_hunter": 1,
    "rejected_no_email": 0,
    "rejected_personal_email": 0,
    "rejected_unverified": 1,
    "rejected_hunter_error": 0,
    "hunter_calls": 1,
  },
  "leads": [
    /* campaign_leads rows (without dedupe_key), all verified */
  ],
  "warnings": ["1 of 3 Apollo results were not saved because no verified email was found."],
}
```

Fewer leads than requested is normal: the pipeline never lowers the bar to hit a number.

Errors: `401` no/invalid token, `404` campaign not found, `400` invalid body, `429` Apollo rate limit (with `retry_after`), `502` Apollo failure, `500` unexpected. Provider error bodies are never returned.

## Credits (free plans)

- Apollo: the search is free, enrichment costs credits for every person returned, so `per_page` is capped at 5
- Hunter: only used for emails Apollo has not verified; a rate-limit or auth error stops further Hunter calls for that request
- Re-running a search never re-verifies leads that are already saved as verified

## Secrets and config

| Name                                | Purpose                                                    |
| ----------------------------------- | ---------------------------------------------------------- |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | injected by Supabase                                       |
| `SUPABASE_SERVICE_ROLE_KEY`         | database writes                                            |
| `APOLLO_API_KEY`                    | required                                                   |
| `HUNTER_API_KEY`                    | optional; without it only Apollo-verified emails are saved |
| `ALLOWED_ORIGINS`                   | comma-separated CORS origins                               |

`config.toml` sets `verify_jwt = false` for this function because it authenticates the caller itself (`auth.getUser()`) and checks campaign ownership.

## Database

Needs migrations `20261006120000_add_campaign_leads_fit_score.sql` (adds `fit_score`, `fit_reason`) and `20261006130000_add_campaign_leads_lead_class.sql` (adds `lead_class`, backfills old rows). Run `pnpm supabase:push` before deploying.

## Test and deploy

```bash
pnpm test:edge
supabase functions deploy lead-pipeline
```
