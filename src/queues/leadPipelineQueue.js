const { Queue } = require('bullmq');
const connection = require('./connection');

const LEAD_PIPELINE_REPEAT_JOB_ID = 'lead-pipeline-repeatable';

const leadPipelineQueue = new Queue('lead-pipeline-queue', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 60000 },
    removeOnComplete: 20,
    removeOnFail: 20,
  },
});

module.exports = leadPipelineQueue;
module.exports.LEAD_PIPELINE_REPEAT_JOB_ID = LEAD_PIPELINE_REPEAT_JOB_ID;
