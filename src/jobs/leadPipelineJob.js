const leadPipelineQueue = require('../queues/leadPipelineQueue');
const LEAD_PIPELINE_REPEAT_JOB_ID = leadPipelineQueue.LEAD_PIPELINE_REPEAT_JOB_ID;
const logger = require('../utils/logger');

const REPEAT_CRON = process.env.LEAD_PIPELINE_CRON || '0 */6 * * *';

async function ensureLeadPipelineRepeatable() {
  const repeatableJobs = await leadPipelineQueue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    if (job.id === LEAD_PIPELINE_REPEAT_JOB_ID || job.name === 'fill-leads-pool') {
      await leadPipelineQueue.removeRepeatableByKey(job.key);
    }
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
