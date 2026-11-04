const { Worker } = require('bullmq');
const connection = require('../queues/connection');
const supabase = require('../config/supabase');
const logger = require('../utils/logger');
const googleAuthService = require('../services/googleAuthService');
const { sendCampaignEmails } = require('../services/campaignMailerService');
const { enqueueCampaignMailJob } = require('../jobs/campaignMailJob');
const { randomDelayMs } = require('../config/mailDelay');
const {
  publishCampaignEvent,
  getCampaignProgressSnapshot,
} = require('../services/campaignEventsPublisher');
const { isCampaignActiveForSend } = require('../services/campaignSendRules');

function calcNextDelay() {
  return randomDelayMs();
}

const MAX_ATTEMPTS = 5; // must match attempts in campaignMailQueue.js

const worker = new Worker(
  'campaign-mail-queue',
  async (job) => {
    if (job.name === 'recover-campaigns') {
      const { recoverCampaigns } = require('../services/campaignRecoveryService');
      return recoverCampaigns();
    }
    const { userId, campaignId, campaignLeadId } = job.data;
    if (job.name === 'manual-outreach') {
      const { runManualCampaignOutreach } = require('../services/campaignManualRunService');
      const result = await runManualCampaignOutreach(userId, campaignId);
      if (result.dailyLimitReached) {
        const tomorrow = new Date();
        tomorrow.setUTCHours(24, 0, 1, 0);
        // BullMQ moves this same durable job rather than creating a duplicate run.
        await job.moveToDelayed(tomorrow.getTime(), job.token);
        const { DelayedError } = require('bullmq');
        throw new DelayedError();
      }
      const { notifyOutreachFinished } = require('../services/notificationService');
      await notifyOutreachFinished(userId, campaignId, result);
      return result;
    }

    const attemptNumber = job.attemptsMade + 1;
    const attemptsLeft = MAX_ATTEMPTS - attemptNumber;
    const isFinalAttempt = attemptNumber >= MAX_ATTEMPTS;

    try {
      // 1. Fetch lead
      const { data: lead, error: fetchError } = await supabase
        .from('campaign_leads')
        .select('*')
        .eq('id', campaignLeadId)
        .single();

      if (fetchError || !lead) {
        throw new Error(`Lead ${campaignLeadId} not found in database`);
      }

      const { data: campaign, error: campaignError } = await supabase
        .from('campaigns')
        .select('id, status')
        .eq('id', campaignId)
        .eq('user_id', userId)
        .single();

      if (campaignError || !campaign) {
        throw new Error(`Campaign ${campaignId} not found`);
      }

      if (!isCampaignActiveForSend(campaign)) {
        logger.warn('[CampaignMailWorker] Campaign not active — skipping send', {
          campaignId,
          status: campaign.status,
          campaignLeadId,
        });
        return {
          success: true,
          skipped: true,
          reason: 'campaign_not_active',
          status: campaign.status,
          leadId: campaignLeadId,
        };
      }

      // Guard: skip if already sent (prevents double-send on BullMQ retries)
      if (lead.status === 'sent') {
        logger.warn('[CampaignMailWorker] Lead already sent — skipping to avoid duplicate', {
          campaignLeadId,
          jobId: job.id,
        });

        // Even though we're skipping this lead, still chain the next one
        // so the rest of the campaign continues.
        await chainNextLead({ userId, campaignId });

        return { success: true, skipped: true, reason: 'already_sent', leadId: campaignLeadId };
      }

      // 2. Get fresh token
      let accessToken;
      try {
        accessToken = await googleAuthService.getValidGoogleAccessToken(userId);
      } catch (err) {
        logger.error('[CampaignMailWorker] Google token unavailable', {
          userId,
          campaignId,
          code: err.code,
          message: err.message,
        });
        await publishCampaignEvent(campaignId, {
          type: 'mail_failed',
          campaignLeadId,
          userId,
          reason: 'google_token',
          code: err.code,
          message: err.message,
          ...(await getCampaignProgressSnapshot(userId, campaignId)),
        });
        throw err;
      }

      // 3. Send email
      const outcome = await sendCampaignEmails(userId, campaignId, accessToken, campaignLeadId);
      if (outcome.dailyLimitReached && !outcome.sent) {
        const tomorrow = new Date();
        tomorrow.setUTCHours(24, 0, 1, 0);
        await enqueueCampaignMailJob(
          { userId, campaignId, campaignLeadId },
          {
            delay: tomorrow.getTime() - Date.now(),
          }
        );
        return { success: true, deferred: true, reason: 'daily_limit_reached' };
      }
      if (outcome.failed) {
        const failure = outcome.results.find((result) => result.status === 'failed');
        const error = new Error(failure?.error || 'Email delivery failed.');
        error.code = failure?.fatalCode;
        throw error;
      }

      await publishCampaignEvent(campaignId, {
        type: outcome.sent ? 'mail_sent' : 'mail_skipped',
        campaignLeadId,
        userId,
        ...(await getCampaignProgressSnapshot(userId, campaignId)),
      });

      // 4. Chain next lead with a random delay.
      //    This is the ONLY place mail jobs are enqueued after the first kickoff,
      //    guaranteeing true sequential sending: send → random delay → send → ...
      await chainNextLead({ userId, campaignId });

      return { success: true, leadId: campaignLeadId };
    } catch (err) {
      logger.error('[CampaignMailWorker] Attempt failed', {
        campaignLeadId,
        attemptNumber,
        attemptsLeft: isFinalAttempt ? 0 : attemptsLeft,
        error: err.message,
        code: err.code,
      });

      if (isFinalAttempt) {
        logger.error('[CampaignMailWorker] All attempts exhausted — marking as failed', {
          campaignLeadId,
          totalAttempts: MAX_ATTEMPTS,
        });

        await supabase
          .from('campaign_leads')
          .update({
            status: 'failed',
            error_message: (err.code ? `[${err.code}] ` : '') + err.message.slice(0, 450),
          })
          .eq('id', campaignLeadId)
          .neq('status', 'sent');

        // Chain continues even after a permanent failure — don't block the rest.
        await chainNextLead({ userId, campaignId });

        await publishCampaignEvent(campaignId, {
          type: 'mail_failed',
          campaignLeadId,
          userId,
          final: true,
          code: err.code,
          message: err.message?.slice(0, 300),
          ...(await getCampaignProgressSnapshot(userId, campaignId)),
        });

        const { notifyEmailFailed } = require('../services/notificationService');
        void notifyEmailFailed(userId, {
          campaignId,
          campaignLeadId,
          message: err.message,
        });
      } else {
        logger.warn('[CampaignMailWorker] Will retry', {
          campaignLeadId,
          attemptNumber,
          attemptsLeft,
          nextRetryNote: 'BullMQ exponential backoff applies',
        });
      }

      throw err; // rethrow so BullMQ handles retry/backoff
    }
  },
  {
    connection,
    concurrency: 1, // must stay 1 — sequential sends require one job at a time
    lockDuration: 60000,
  }
);

// ─── Helper ───────────────────────────────────────────────────────────────────

async function chainNextLead({ userId, campaignId }) {
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('status, run_mode')
    .eq('id', campaignId)
    .eq('user_id', userId)
    .single();

  if (!isCampaignActiveForSend(campaign)) {
    await publishCampaignEvent(campaignId, {
      type: 'campaign_progress',
      ...(await getCampaignProgressSnapshot(userId, campaignId)),
    });
    return;
  }

  const { data: nextLead } = await supabase
    .from('campaign_leads')
    .select('id')
    .eq('campaign_id', campaignId)
    .eq('user_id', userId)
    .eq('status', 'template_generated')
    .not('mail_template', 'is', null)
    .neq('mail_template', '')
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

  if (nextLead) {
    const delayMs = calcNextDelay();
    await enqueueCampaignMailJob(
      { userId, campaignId, campaignLeadId: nextLead.id },
      { delay: delayMs }
    );
  } else {
    // No ready-to-send leads left. If auto campaign has no pending work, mark completed.
    const { maybeCompleteCampaign } = require('../services/campaignCompletionService');
    await maybeCompleteCampaign(userId, campaignId);
  }

  await publishCampaignEvent(campaignId, {
    type: 'campaign_progress',
    ...(await getCampaignProgressSnapshot(userId, campaignId)),
  });
}

// ─── Events ───────────────────────────────────────────────────────────────────

worker.on('error', (err) => {
  logger.error('[CampaignMailWorker] Critical Worker Error', { error: err.message });
});

async function start() {
  const queue = require('../queues/campaignMailQueue');
  await queue.upsertJobScheduler(
    'campaign-recovery',
    { every: 60000 },
    { name: 'recover-campaigns', data: {} }
  );
}

module.exports = { worker, start };

if (require.main === module) {
  require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
  const { assertWorkerCampaignMailEnv } = require('../config/requiredEnv');
  try {
    assertWorkerCampaignMailEnv();
  } catch (err) {
    console.error(err.message);

    process.exit(1);
  }
  start().catch((err) => {
    logger.error('Failed to schedule recovery', { error: err.message });
    process.exit(1);
  });
}
