const cron               = require('node-cron');
const supabase           = require('../config/supabase');
const { sendCampaignEmails } = require('../services/Campaignmailerservice');
const googleAuthService  = require('../services/googleAuthService');
const logger             = require('../utils/logger');

// ─── Schedule ─────────────────────────────────────────────────────────────────

const SCHEDULE = process.env.CRON_MAIL_SCHEDULE || '0 * * * *'; // default: every hour

// ─── Core worker function ─────────────────────────────────────────────────────

/**
 * Fetch all active campaigns eligible for auto-sending.
 * Joins with `users` to pull the owner's name and email in one query.
 *
 * run_mode 'auto'      → always processed by the worker
 * run_mode 'scheduled' → processed by the worker (manual mode requires API call)
 */
async function fetchEligibleCampaigns() {
  // Fetch active auto/scheduled campaigns, joining:
  //   users       → email (all users have this)
  //   google_accounts → name (set during Google OAuth; may be null for email-only users)
  const { data, error } = await supabase
    .from('campaigns')
    .select(`
      id,
      name,
      user_id,
      run_mode,
      users (
        id,
        email,
        name,
        google_accounts (
          name
        )
      )
    `)
    .eq('status', 'active')
    .in('run_mode', ['auto', 'scheduled']);

  if (error) {
    logger.error('[CampaignMailWorker] Failed to fetch eligible campaigns', {
      error: error.message,
    });
    return [];
  }

  return data || [];
}

/**
 * Check whether a campaign has any pending leads with a generated template.
 * Returns the count — skip the campaign if 0.
 */
async function hasPendingLeads(campaignId) {
  const { count, error } = await supabase
    .from('campaign_leads')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .eq('status', 'pending')
    .not('mail_template', 'is', null)
    .neq('mail_template', '');

  if (error) return 0;
  return count || 0;
}

/**
 * Main worker tick — runs once per cron interval.
 */
async function runWorkerTick() {
  logger.info('[CampaignMailWorker] Tick started');

  const campaigns = await fetchEligibleCampaigns();

  if (campaigns.length === 0) {
    logger.info('[CampaignMailWorker] No eligible campaigns found — nothing to do');
    return;
  }

  logger.info(`[CampaignMailWorker] Processing ${campaigns.length} eligible campaign(s)`);

  for (const campaign of campaigns) {
    const { id: campaignId, name: campaignName, user_id: userId, users: userRow } = campaign;

    // ── Pull the user's name from google_accounts (set during Google OAuth) ──
    //    Falls back to the email prefix for email/password users who have no
    //    Google account linked (google_accounts will be null or an empty array).
    const googleAccount = Array.isArray(userRow?.google_accounts)
      ? userRow.google_accounts[0]
      : userRow?.google_accounts;

    const userName =
      googleAccount?.name ||                                          // Google OAuth name
      userRow?.name ||                                                // email/password name
      (userRow?.email ? userRow.email.split('@')[0] : `user:${userId}`); // fallback

    logger.info(`[CampaignMailWorker] → Campaign "${campaignName}" owned by "${userName}"`, {
      campaignId,
      userId,
    });

    // ── Skip if no pending leads with templates ──────────────────────────────
    const pendingCount = await hasPendingLeads(campaignId);
    if (pendingCount === 0) {
      logger.info(`[CampaignMailWorker]   No pending leads — skipping`, { campaignId });
      continue;
    }

    logger.info(`[CampaignMailWorker]   ${pendingCount} pending lead(s) ready to send`, {
      campaignId,
    });

    // ── Resolve Google OAuth access token ────────────────────────────────────
    let accessToken;
    try {
      accessToken = await googleAuthService.getValidGoogleAccessToken(userId);
    } catch (tokenErr) {
      logger.warn(
        `[CampaignMailWorker]   Skipping — could not obtain Google access token for "${userName}"`,
        { campaignId, userId, error: tokenErr.message },
      );
      continue; // Don't block other campaigns
    }

    // ── Send emails ──────────────────────────────────────────────────────────
    try {
      const summary = await sendCampaignEmails(userId, campaignId, accessToken);

      logger.info(`[CampaignMailWorker]   Done for "${campaignName}" (owner: "${userName}")`, {
        campaignId,
        userId,
        userName,
        sent:              summary.sent,
        failed:            summary.failed,
        skipped:           summary.skipped,
        totalSentToday:    summary.totalSentToday,
        dailyLimitReached: summary.dailyLimitReached,
      });
    } catch (sendErr) {
      logger.error(
        `[CampaignMailWorker]   Failed to send emails for campaign "${campaignName}"`,
        {
          campaignId,
          userId,
          userName,
          error: sendErr.message,
        },
      );
      // Continue to the next campaign — one failure shouldn't block others
    }
  }

  logger.info('[CampaignMailWorker] Tick complete');
}

// ─── Start the cron job ───────────────────────────────────────────────────────

function start() {
  if (!cron.validate(SCHEDULE)) {
    logger.error(`[CampaignMailWorker] Invalid cron schedule: "${SCHEDULE}" — worker NOT started`);
    return;
  }

  logger.info(`[CampaignMailWorker] Scheduled with pattern: "${SCHEDULE}"`);

  cron.schedule(SCHEDULE, async () => {
    try {
      await runWorkerTick();
    } catch (err) {
      // Safety net — prevent an unhandled rejection from crashing the process
      logger.error('[CampaignMailWorker] Unhandled error in tick', { error: err.message });
    }
  });
}

module.exports = { start, runWorkerTick }; // export runWorkerTick for manual testing