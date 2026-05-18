const followUpSchedulerQueue = require('../queues/followUpSchedulerQueue');
const FOLLOW_UP_SCHEDULER_REPEAT_JOB_ID = followUpSchedulerQueue.FOLLOW_UP_SCHEDULER_REPEAT_JOB_ID;
const logger = require('../utils/logger');

const REPEAT_CRON = process.env.FOLLOW_UP_CRON || '0 */6 * * *';

async function ensureFollowUpSchedulerRepeatable() {
  const repeatableJobs = await followUpSchedulerQueue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    if (job.id === FOLLOW_UP_SCHEDULER_REPEAT_JOB_ID || job.name === 'scan-due-follow-ups') {
      await followUpSchedulerQueue.removeRepeatableByKey(job.key);
    }
  }

  await followUpSchedulerQueue.add(
    'scan-due-follow-ups',
    {},
    {
      repeat: { pattern: REPEAT_CRON },
      jobId: FOLLOW_UP_SCHEDULER_REPEAT_JOB_ID,
    }
  );

  logger.info('[FollowUpScheduler] Repeatable job registered', { cron: REPEAT_CRON });
}

module.exports = { ensureFollowUpSchedulerRepeatable, REPEAT_CRON };
