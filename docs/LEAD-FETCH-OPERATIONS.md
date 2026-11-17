# Six-hour lead fetching

The `lead-pipeline-queue` BullMQ worker executes `fill-leads-pool` using `LEAD_PIPELINE_CRON` (default `0 */6 * * *`). The default UTC schedule is 00:00, 06:00, 12:00, and 18:00: 05:00, 11:00, 17:00, and 23:00 in Pakistan. It attempts four runs daily; it does not guarantee new leads in every run.

## Deployment requirements

- A running web process with `RUN_WORKERS_IN_WEB=1`, or a separately running `node src/workers/leadPipelineWorker.js` process.
- Working Redis shared by the scheduler and worker. Local `REDIS_HOST=localhost` cannot inspect Render's production queue.
- Supabase credentials and Apollo API key in the worker environment; Hunter is optional but required for the fallback email-verification path.
- A process that stays running at scheduled times. The repository's free Render web service configuration can sleep after 15 minutes without inbound traffic. A queued job cannot wake a sleeping web service. Use an always-running service for reliable scheduling; this change does not purchase or provision one.

References: [Render free-service spin-down](https://render.com/docs/free#spinning-down-on-idle), [BullMQ repeatable jobs](https://docs.bullmq.io/guide/jobs/repeatable).

## Recovery behavior

Worker startup preserves the existing matching repeat schedule and its overdue job. Previously, every startup removed the schedule and recreated it for the next six-hour boundary, potentially discarding a run accumulated while the service slept. Changed or duplicate schedules are cleaned up without replacing the current matching schedule.

A missing Apollo key and failures across all categories now fail the BullMQ job, allowing its configured retry policy and failed-job tracking to work. Individual category failures remain logged; successful categories may still complete. Zero new leads after a successful search is a valid outcome. Completion logs distinguish found results, already-verified duplicates, rejected results, saved rows, and failed categories.

No code change alone guarantees execution while the hosting service is asleep. Check the actual service plan, `RUN_WORKERS_IN_WEB`, Redis connectivity, and worker startup before expecting the next scheduled run.

## Investigation on November 17, 2026

- Both production API health endpoints responded successfully.
- The deployed API YAML at the custom domain and Render domain exactly matched local HEAD `54eec7c9` before these scheduler fixes. The frontend's live campaign bundle also contained the latest retry flag and unverified-workflow label. These checks confirm deployed feature artifacts, rather than an independently reported runtime Git SHA.
- The configured Supabase lead pool contained 109 rows. Latest `created_at`: October 30, 2026, 09:53:30 UTC (14:53:30 Pakistan). No rows were created in the preceding 17 days.
- Using local provider credentials, Apollo zero-credit search and Hunter account inspection returned HTTP 200. Hunter had credits remaining. These checks do not establish that production has identical environment variables or that Apollo paid enrichment succeeds.
- Configured searches for the first category in each entity returned zero results, while the existing broad fallback returned matches. Search success alone does not establish email-enrichment or insertion success.
- The page selector cycles through pages 1–10. Repeated pages may return already-verified rows and legitimately save zero new records. This paging behavior is unchanged by this recovery fix.
- Production Redis credentials and Render logs were unavailable, so worker execution history and the definitive production-side cause could not be inspected.

Scheduler fixes are local until committed, pushed, and deployed. No migration is required. No paid enrichment requests or manual lead imports were performed during diagnostics.
