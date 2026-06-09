const { Worker } = require('bullmq');
const connection = require('../queues/connection');
const supabase = require('../config/supabase');
const logger = require('../utils/logger');
const googleAuthService = require('../services/googleAuthService');
const { sendCampaignEmails } = require('../services/campaignMailerService');
const { enqueueCampaignMailJob } = require('../jobs/campaignMailJob');
const { randomDelayMs } = require('../config/mailDelay');
const { publishCampaignEvent, getCampaignProgressSnapshot } = require('../services/campaignEventsPublisher');
const { isCampaignActiveForSend } = require('../services/campaignSendRules');

function calcNextDelay() {
  return randomDelayMs();
}

const MAX_ATTEMPTS = 5; // must match attempts in campaignMailQueue.js

const worker = new Worker(
  'campaign-mail-queue',
  async (job) => {
    const { userId, campaignId, campaignLeadId } = job.data;

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
      await sendCampaignEmails(userId, campaignId, accessToken, campaignLeadId);

      await publishCampaignEvent(campaignId, {
        type: 'mail_sent',
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
          .eq('id', campaignLeadId);

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
    await maybeCompleteAutoCampaignIfDone({ userId, campaignId, campaign });
  }

  await publishCampaignEvent(campaignId, {
    type: 'campaign_progress',
    ...(await getCampaignProgressSnapshot(userId, campaignId)),
  });
}

async function maybeCompleteAutoCampaignIfDone({ userId, campaignId, campaign }) {
  if (!campaign || campaign.run_mode !== 'auto' || campaign.status !== 'active') return;

  const { count, error } = await supabase
    .from('campaign_leads')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .eq('user_id', userId)
    .in('status', ['pending', 'template_generated']);

  if (error) {
    logger.warn('[CampaignMailWorker] completion-check failed', {
      campaignId,
      userId,
      error: error.message,
    });
    return;
  }

  if ((count || 0) > 0) return;

  const { error: updateError } = await supabase
    .from('campaigns')
    .update({ status: 'completed' })
    .eq('id', campaignId)
    .eq('user_id', userId)
    .eq('status', 'active');

  if (updateError) {
    logger.warn('[CampaignMailWorker] failed to mark completed', {
      campaignId,
      userId,
      error: updateError.message,
    });
  }
}

// ─── Events ───────────────────────────────────────────────────────────────────

worker.on('error', (err) => {
  logger.error('[CampaignMailWorker] Critical Worker Error', { error: err.message });
});

function start() {}

module.exports = { worker, start };

if (require.main === module) {
  require('dotenv').config();
  const { assertWorkerCampaignMailEnv } = require('../config/requiredEnv');
  try {
    assertWorkerCampaignMailEnv();
  } catch (err) {
    console.error(err.message);
    // eslint-disable-next-line n/no-process-exit -- standalone worker bootstrap
    process.exit(1);
  }
  start();
}
