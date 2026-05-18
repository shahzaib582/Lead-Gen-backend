const { Queue } = require('bullmq');
const connection = require('./connection');

const FOLLOW_UP_SCHEDULER_REPEAT_JOB_ID = 'follow-up-scheduler-repeatable';

const followUpSchedulerQueue = new Queue('follow-up-scheduler-queue', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 60000 },
    removeOnComplete: 50,
    removeOnFail: 20,
  },
});

module.exports = followUpSchedulerQueue;
module.exports.FOLLOW_UP_SCHEDULER_REPEAT_JOB_ID = FOLLOW_UP_SCHEDULER_REPEAT_JOB_ID;
