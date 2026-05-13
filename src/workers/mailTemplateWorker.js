const { Worker } = require('bullmq');
const connection = require('../queues/connection');
const supabase = require('../config/supabase');
const logger = require('../utils/logger');
const { generateMailTemplates } = require('../services/mailTemplateService');
const campaignMailQueue = require('../queues/campaignMailQueue');
const { enqueueCampaignMailJob } = require('../jobs/campaignMailJob');

const MAX_ATTEMPTS = 3; // must match attempts in mailTemplateQueue.js

const worker = new Worker(
  'mail-template-queue',
  async (job) => {
    const { userId, campaignId, campaignLeadId } = job.data;

    const attemptNumber = job.attemptsMade + 1;
    const attemptsLeft = MAX_ATTEMPTS - attemptNumber;
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

      // 4. Mark lead as template_generated
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

      // 5. Kick off the mail chain ONLY if no mail job is currently
      //    waiting/delayed/active for this campaign.
      //    campaignMailWorker handles all subsequent delays via chaining —
      //    we must NOT enqueue every lead here or they all fire at once.
      const counts = await campaignMailQueue.getJobCounts('waiting', 'delayed', 'active');
      const activeChain = counts.waiting + counts.delayed + counts.active;

      if (activeChain === 0) {
        await enqueueCampaignMailJob({ userId, campaignId, campaignLeadId }, { delay: 0 });
        logger.info('[TemplateWorker] No active chain — kicked off mail chain', {
          campaignLeadId,
          attemptNumber,
        });
      } else {
        // Chain is already running; campaignMailWorker will pick this lead
        // up via the DB query after it finishes the current send.
        logger.info(
          '[TemplateWorker] Mail chain already active — lead will be picked up automatically',
          {
            campaignLeadId,
            activeChain,
          }
        );
      }

      return true;
    } catch (err) {
      logger.error('[TemplateWorker] Attempt failed', {
        campaignLeadId,
        attemptNumber,
        attemptsLeft: isFinalAttempt ? 0 : attemptsLeft,
        error: err.message,
      });

      if (isFinalAttempt) {
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
        logger.warn('[TemplateWorker] Will retry', {
          campaignLeadId,
          attemptNumber,
          attemptsLeft,
          nextRetryNote: 'BullMQ exponential backoff applies',
        });
      }

      throw err;
    }
  },
  {
    connection,
    concurrency: 3,
    removeOnComplete: { count: 100 },
    removeOnFail: false,
  }
);

worker.on('completed', (job) => logger.info('[TemplateWorker] Job completed', { jobId: job.id }));
worker.on('failed', (job, err) =>
  logger.error('[TemplateWorker] Job failed', { jobId: job?.id, error: err.message })
);
worker.on('error', (err) => logger.error('[TemplateWorker] Worker error', { error: err.message }));

function start() {
  console.log('🚀 Mail Template Worker is active and listening...');
}

module.exports = { worker, start };
