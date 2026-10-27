const { Worker } = require('bullmq');
const connection = require('../queues/connection');
const logger = require('../utils/logger');
const { processDueFollowUps } = require('../services/followUpSchedulerService');
const { ensureFollowUpSchedulerRepeatable } = require('../jobs/followUpSchedulerJob');

const worker = new Worker('follow-up-scheduler-queue', async () => processDueFollowUps(), {
  connection,
  concurrency: 1,
  lockDuration: 600000,
});

worker.on('failed', (job, err) =>
  logger.error('[FollowUpSchedulerWorker] Job failed', { jobId: job?.id, error: err.message })
);
worker.on('error', (err) =>
  logger.error('[FollowUpSchedulerWorker] Worker error', { error: err.message })
);

async function start() {
  await ensureFollowUpSchedulerRepeatable();
}

module.exports = { worker, start };

if (require.main === module) {
  require('dotenv').config();
  const { assertWorkerFollowUpSchedulerEnv } = require('../config/requiredEnv');
  try {
    assertWorkerFollowUpSchedulerEnv();
  } catch (err) {
    console.error(err.message);

    process.exit(1);
  }
  start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
