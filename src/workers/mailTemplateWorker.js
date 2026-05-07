const { Worker } = require('bullmq');
const connection = require('../queues/connection');
const supabase = require('../config/supabase');
const logger = require('../utils/logger');
const { generateMailTemplates } = require('../services/mailTemplateService');
const { enqueueCampaignMailJob } = require('../jobs/campaignMailJob');

const worker = new Worker(
  'mail-template-queue',
  async (job) => {
    const { userId, campaignId, campaignLeadId } = job.data;

    logger.info('[TemplateWorker] Started', { jobId: job.id, campaignLeadId });

    try {
      // 1. Get lead
      const { data: lead, error } = await supabase
        .from('campaign_leads')
        .select('*')
        .eq('id', campaignLeadId)
        .single();

      if (error || !lead) throw new Error('Lead not found');

      // 2. Generate template
      const generatedTemplate = await generateMailTemplates(userId, campaignId, campaignLeadId);
      if (!generatedTemplate) throw new Error('Template generation failed');

      // 3. FIX: Mark lead as template_generated so it won't be re-processed
      const { error: statusError } = await supabase
        .from('campaign_leads')
        .update({ status: 'template_generated' })
        .eq('id', campaignLeadId);

      if (statusError) {
        logger.warn('[TemplateWorker] Failed to update status to template_generated', {
          campaignLeadId,
          error: statusError.message,
        });
      }

      // 4. Queue mail sending with RANDOM DELAY (e.g., 5 to 60 seconds)
      const minDelay = 5000;
      const maxDelay = 60000;
      const randomDelay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;

      // FIX: options are now properly forwarded in campaignMailJob.js
      await enqueueCampaignMailJob(
        { userId, campaignId, campaignLeadId },
        { delay: randomDelay }
      );

      logger.info('[TemplateWorker] Completed & Mail Queued', {
        campaignLeadId,
        delayMs: randomDelay,
      });

      return true;
    } catch (err) {
      logger.error('[TemplateWorker] Failed', { campaignLeadId, error: err.message });

      await supabase
        .from('campaign_leads')
        .update({ status: 'failed' })
        .eq('id', campaignLeadId);

      throw err;
    }
  },
  {
    connection,
    concurrency: 3,
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  }
);

// Events
worker.on('completed', (job) => logger.info('[TemplateWorker] Job completed', { jobId: job.id }));
worker.on('failed', (job, err) => logger.error('[TemplateWorker] Job failed', { jobId: job?.id, error: err.message }));
worker.on('error', (err) => logger.error('[TemplateWorker] Worker error', { error: err.message }));

function start() {
  console.log('🚀 Mail Template Worker is active and listening...');
}

module.exports = { worker, start };