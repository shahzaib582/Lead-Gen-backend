const leadPipelineQueue = require('../queues/leadPipelineQueue');
const LEAD_PIPELINE_REPEAT_JOB_ID = leadPipelineQueue.LEAD_PIPELINE_REPEAT_JOB_ID;
const logger = require('../utils/logger');

const REPEAT_CRON = process.env.LEAD_PIPELINE_CRON || '0 */6 * * *';

async function ensureLeadPipelineRepeatable() {
  const repeatableJobs = await leadPipelineQueue.getRepeatableJobs();
  const ownedJobs = repeatableJobs.filter(
    (job) => job.id === LEAD_PIPELINE_REPEAT_JOB_ID || job.name === 'fill-leads-pool'
  );
  // Preserve an existing due/overdue job when a sleeping web service wakes up.
  // Deleting the same schedule here discards the missed run and moves it six hours ahead.
  const existing = ownedJobs.find(
    (job) => job.pattern === REPEAT_CRON && (!job.tz || job.tz === 'UTC')
  );
  for (const job of ownedJobs) {
    if (job.key !== existing?.key) {
      await leadPipelineQueue.removeRepeatableByKey(job.key);
    }
  }

  if (existing) {
    logger.info('[LeadPipelineCron] Existing schedule preserved', {
      cron: REPEAT_CRON,
      next: existing.next,
    });
    return;
  }

  await leadPipelineQueue.add(
    'fill-leads-pool',
    {},
    {
      repeat: { pattern: REPEAT_CRON },
      jobId: LEAD_PIPELINE_REPEAT_JOB_ID,
    }
  );

  logger.info('[LeadPipelineCron] Repeatable job registered', { cron: REPEAT_CRON });
}

module.exports = { ensureLeadPipelineRepeatable, REPEAT_CRON };
