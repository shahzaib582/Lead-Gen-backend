const { Worker } = require('bullmq');
const connection = require('../queues/connection');
const supabase = require('../config/supabase');
const logger = require('../utils/logger');
const googleAuthService = require('../services/googleAuthService');
const { sendCampaignEmails } = require('../services/campaignMailerService');

const MAX_ATTEMPTS = 5; // must match attempts in campaignMailQueue.js

const worker = new Worker(
  'campaign-mail-queue',
  async (job) => {
    const { userId, campaignId, campaignLeadId } = job.data;

    const attemptNumber  = job.attemptsMade + 1; // attemptsMade is 0-indexed
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

      // 2. Get fresh token
      const accessToken = await googleAuthService.getValidGoogleAccessToken(userId);

      // 3. Send email
      await sendCampaignEmails(userId, campaignId, accessToken, campaignLeadId);

      // 4. Update status to 'sent' on success
      const { error: updateError } = await supabase
        .from('campaign_leads')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          error_message: null, // clear any previous error
        })
        .eq('id', campaignLeadId);

      if (updateError) throw updateError;

      logger.info('[CampaignMailWorker] Successfully sent', {
        campaignLeadId,
        attemptNumber,
      });

      return { success: true, leadId: campaignLeadId };

    } catch (err) {
      logger.error('[CampaignMailWorker] Attempt failed', {
        campaignLeadId,
        attemptNumber,
        attemptsLeft: isFinalAttempt ? 0 : attemptsLeft,
        error: err.message,
      });

      if (isFinalAttempt) {
        // All retries exhausted — mark as permanently failed in Supabase
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
      } else {
        // Still have retries left — log but don't touch the status
        logger.warn('[CampaignMailWorker] Will retry', {
          campaignLeadId,
          attemptNumber,
          attemptsLeft,
          nextRetryNote: 'BullMQ exponential backoff applies',
        });
      }

      throw err; // always rethrow so BullMQ handles the retry/backoff
    }
  },
  {
    connection,
    concurrency: 2,
    lockDuration: 60000,
  }
);

worker.on('error', (err) => {
  logger.error('[CampaignMailWorker] Critical Worker Error', { error: err.message });
});

function start() {
  console.log('Campaign Mail Worker is active and listening for jobs...');
}

module.exports = { worker, start };