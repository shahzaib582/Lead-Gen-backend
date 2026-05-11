const { Worker } = require('bullmq');
const connection = require('../queues/connection');
const supabase = require('../config/supabase');
const logger = require('../utils/logger');
const { generateMailTemplates } = require('../services/mailTemplateService');
const { enqueueCampaignMailJob } = require('../jobs/campaignMailJob');

const MAX_ATTEMPTS = 3; // must match attempts in mailTemplateQueue.js

const worker = new Worker(
  'mail-template-queue',
  async (job) => {
    const { userId, campaignId, campaignLeadId } = job.data;

    const attemptNumber  = job.attemptsMade + 1; // attemptsMade is 0-indexed
    const attemptsLeft   = MAX_ATTEMPTS - attemptNumber;
    const isFinalAttempt = attemptNumber >= MAX_ATTEMPTS;

    logger.info('[TemplateWorker] Started', {
      jobId: job.id,
      campaignLeadId,
      attemptNumber,
      isFinalAttempt,
    });

    try {
      // 1. Get lead
      const { data: lead, error } = await supabase
        .from('campaign_leads')
        .select('*')
        .eq('id', campaignLeadId)
        .single();

      if (error || !lead) throw new Error('Lead not found');

      // 2. Generate template
const result = await generateMailTemplates(userId, campaignId, campaignLeadId);

// Check the result object properly — it returns { processed, failed, total, results }
if (!result || result.processed === 0) {
  const reason = result?.results?.[0]?.error || 'Template generation failed with no output';
  throw new Error(reason);
}

// 3. Verify the template was actually saved in DB before marking status
const { data: updatedLead, error: verifyError } = await supabase
  .from('campaign_leads')
  .select('mail_template')
  .eq('id', campaignLeadId)
  .single();

if (verifyError || !updatedLead?.mail_template) {
  throw new Error('Template generation reported success but mail_template is null in DB');
}

// 4. Mark lead as template_generated only after confirming template exists
const { error: statusError } = await supabase
  .from('campaign_leads')
  .update({ status: 'template_generated', error_message: null })
  .eq('id', campaignLeadId);

      if (statusError) {
        logger.warn('[TemplateWorker] Failed to update status to template_generated', {
          campaignLeadId,
          error: statusError.message,
        });
      }

      // 4. Queue mail sending with random delay
      const minDelay = 50;   // 50 seconds
      const maxDelay = 600  // 10 minutes
      const randomDelay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;

      await enqueueCampaignMailJob(
        { userId, campaignId, campaignLeadId },
        { delay: randomDelay }
      );

      logger.info('[TemplateWorker] Completed & Mail Queued', {
        campaignLeadId,
        attemptNumber,
        delayMs: randomDelay,
      });

      return true;

    } catch (err) {
      logger.error('[TemplateWorker] Attempt failed', {
        campaignLeadId,
        attemptNumber,
        attemptsLeft: isFinalAttempt ? 0 : attemptsLeft,
        error: err.message,
      });

      if (isFinalAttempt) {
        // All retries exhausted — mark as permanently failed in Supabase
        logger.error('[TemplateWorker] All attempts exhausted — marking as failed', {
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
        // Still have retries left — don't touch status, let BullMQ retry
        logger.warn('[TemplateWorker] Will retry', {
          campaignLeadId,
          attemptNumber,
          attemptsLeft,
          nextRetryNote: 'BullMQ exponential backoff applies',
        });
      }

      throw err; // always rethrow so BullMQ handles retry/backoff
    }
  },
  {
    connection,
    concurrency: 3,
    removeOnComplete: { count: 100 },
    removeOnFail: false, // keep failed jobs for inspection
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