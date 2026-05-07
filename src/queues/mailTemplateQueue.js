const { Queue } = require('bullmq');
const connection = require('./connection');

const mailTemplateQueue = new Queue(
  'mail-template-queue',
  {
    connection,

    defaultJobOptions: {
      attempts: 3,

      backoff: {
        type: 'exponential',
        delay: 5000,
      },

      removeOnComplete: 100,
      removeOnFail: 500,
    },
  }
);

module.exports = mailTemplateQueue;