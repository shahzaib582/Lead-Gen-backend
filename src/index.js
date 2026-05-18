require('dotenv').config();

const { assertWebEnv, shouldRunWorkersInWeb } = require('./config/requiredEnv');

try {
  assertWebEnv();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const app = require('./app');
const logger = require('./utils/logger');

const PORT = Number(process.env.PORT) || 3000;

let mailTemplateWorker;
let campaignMailWorker;

if (shouldRunWorkersInWeb()) {
  mailTemplateWorker = require('./workers/mailTemplateWorker');
  campaignMailWorker = require('./workers/campaignMailWorker');
}

const server = app.listen(PORT, () => {
  const env = process.env.NODE_ENV || 'development';
  logger.info(`Server running on port ${PORT} [${env}]`);
  logger.info(`Swagger UI: ${(process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '')}/api/docs`);

  if (mailTemplateWorker && campaignMailWorker) {
    mailTemplateWorker.start();
    campaignMailWorker.start();
    logger.info('BullMQ workers started in web process (RUN_WORKERS_IN_WEB or non-production)');
  } else {
    logger.info('BullMQ workers not started in web process — use dedicated worker dynos');
  }
});

process.on('SIGTERM', () => shutdown());
process.on('SIGINT', () => shutdown());

async function shutdown() {
  server.close(async () => {
    if (mailTemplateWorker?.worker) {
      await mailTemplateWorker.worker.close();
    }
    if (campaignMailWorker?.worker) {
      await campaignMailWorker.worker.close();
    }
    process.exit(0);
  });
}

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise Rejection', { reason });
  server.close(() => process.exit(1));
});
