const { Worker } = require('bullmq');
const connection = require('../queues/connection');
const logger = require('../utils/logger');
const { runScheduledLeadPipeline } = require('../services/leadPipelineCronService');
const { ensureLeadPipelineRepeatable } = require('../jobs/leadPipelineJob');

const worker = new Worker('lead-pipeline-queue', async () => runScheduledLeadPipeline(), {
  connection,
  concurrency: 1,
  lockDuration: 900000,
});

worker.on('failed', (job, err) =>
  logger.error('[LeadPipelineWorker] Job failed', { jobId: job?.id, error: err.message })
);
worker.on('error', (err) => logger.error('[LeadPipelineWorker] Worker error', { error: err.message }));

async function start() {
  await ensureLeadPipelineRepeatable();
}

module.exports = { worker, start };

if (require.main === module) {
  require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
  const { assertWorkerLeadPipelineEnv } = require('../config/requiredEnv');
  try {
    assertWorkerLeadPipelineEnv();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
