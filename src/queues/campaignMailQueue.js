const { Queue } = require('bullmq');
const connection = require('./connection');

const campaignMailQueue = new Queue(
  'campaign-mail-queue',
  {
    connection,

    defaultJobOptions: {
      attempts: 5,

      backoff: {
        type: 'exponential',
        delay: 10000,
      },

      removeOnComplete: 100,
      removeOnFail: false,
    },
  }
);

module.exports = campaignMailQueue;