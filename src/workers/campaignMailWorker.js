const { Worker } = require('bullmq');
const connection = require('../queues/connection');
const supabase = require('../config/supabase');
const logger = require('../utils/logger');
const googleAuthService = require('../services/googleAuthService');
const { sendCampaignEmails } = require('../services/campaignMailerService');
const { enqueueCampaignMailJob } = require('../jobs/campaignMailJob');

// Random delay between consecutive sends.
// Set MAIL_DELAY_MIN_MS / MAIL_DELAY_MAX_MS in your env to override.
// Defaults: 10s – 60s (human-like spacing, helps avoid Gmail rate limits).
const DELAY_MIN_MS = Number(process.env.MAIL_DELAY_MIN_MS) || 10000;  // 10s
const DELAY_MAX_MS = Number(process.env.MAIL_DELAY_MAX_MS) || 60000;  // 60s

function calcNextDelay() {
  return Math.floor(Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS + 1)) + DELAY_MIN_MS;
}

const MAX_ATTEMPTS = 5; // must match attempts in campaignMailQueue.js

const worker = new Worker(
  'campaign-mail-queue',
  async (job) => {
    const { userId, campaignId, campaignLeadId } = job.data;

    const attemptNumber  = job.attemptsMade + 1;
    const attemptsLeft   = MAX_ATTEMPTS - attemptNumber;
    const isFinalAttempt = attemptNumber >= MAX_ATTEMPTS;

    logger.info('[CampaignMailWorker] Started processing', {
      campaignLeadId,
      jobId: job.id,
      attemptNumber,
      isFinalAttempt,
    });

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
      const accessToken = await googleAuthService.getValidGoogleAccessToken(userId);

      // 3. Send email
      await sendCampaignEmails(userId, campaignId, accessToken, campaignLeadId);

      logger.info('[CampaignMailWorker] Successfully sent', {
        campaignLeadId,
        attemptNumber,
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
            error_message: err.message.slice(0, 500),
          })
          .eq('id', campaignLeadId);

        // Chain continues even after a permanent failure — don't block the rest.
        await chainNextLead({ userId, campaignId });
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
    concurrency: 1,   // must stay 1 — sequential sends require one job at a time
    lockDuration: 60000,
  }
);

// ─── Helper ───────────────────────────────────────────────────────────────────

async function chainNextLead({ userId, campaignId }) {
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
    logger.info('[CampaignMailWorker] Next lead queued with delay', {
      nextCampaignLeadId: nextLead.id,
      delayMs,
      delaySeconds: Math.round(delayMs / 1000),
    });
  } else {
    logger.info('[CampaignMailWorker] No more pending leads for campaign', { campaignId });
  }
}

// ─── Events ───────────────────────────────────────────────────────────────────

worker.on('error', (err) => {
  logger.error('[CampaignMailWorker] Critical Worker Error', { error: err.message });
});

function start() {
  console.log('Campaign Mail Worker is active and listening for jobs...');
}

module.exports = { worker, start };