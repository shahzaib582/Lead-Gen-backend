const { Worker } = require('bullmq');
const connection = require('../queues/connection');
const supabase = require('../config/supabase');
const logger = require('../utils/logger');
const googleAuthService = require('../services/googleAuthService');
const { sendCampaignEmails } = require('../services/Campaignmailerservice');

const worker = new Worker(
  'campaign-mail-queue',
  async (job) => {
    const { userId, campaignId, campaignLeadId } = job.data;

    logger.info('[CampaignMailWorker] Started processing', { campaignLeadId, jobId: job.id });

    try {
      // 1. Fetch lead with error handling
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

      // 4. Update status to 'sent'
      const { error: updateError } = await supabase
        .from('campaign_leads')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
        })
        .eq('id', campaignLeadId);

      if (updateError) throw updateError;

      logger.info('[CampaignMailWorker] Successfully sent and updated', { campaignLeadId });
      return { success: true, leadId: campaignLeadId };

    } catch (err) {
      logger.error('[CampaignMailWorker] Execution Error', {
        campaignLeadId,
        error: err.message,
      });

      await supabase
        .from('campaign_leads')
        .update({ status: 'failed' })
        .eq('id', campaignLeadId);

      throw err;
    }
  },
  {
    connection,
    concurrency: 2,
    lockDuration: 60000, // FIX: uncommented — prevents stalled job retries during slow Gmail sends + token refresh
  }
);

// Global Error listener for the worker itself (connection issues, etc)
worker.on('error', (err) => {
  logger.error('[CampaignMailWorker] Critical Worker Error', { error: err.message });
});

function start() {
  console.log('Campaign Mail Worker is active and listening for jobs...');
}

module.exports = {
  worker,
  start,
};