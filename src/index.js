require('dotenv').config();

// 1. Import both workers properly
const mailTemplateWorker = require('./workers/mailTemplateWorker');
const campaignMailWorker = require('./workers/campaignMailWorker');

// Validate required env vars
const REQUIRED_ENV = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'JWT_SECRET',
  'SMTP_HOST',
  'SMTP_USER',
  'SMTP_PASS',
  'EMAIL_FROM',
];

const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const app    = require('./app');
const logger = require('./utils/logger');

const PORT = Number(process.env.PORT) || 3000;

const server = app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);

  // 2. Start BOTH background workers
  mailTemplateWorker.start();
  campaignMailWorker.start();
});

// Graceful shutdown
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT')); // Handle Ctrl+C

async function shutdown(signal) {
  logger.info(`${signal} received — shutting down gracefully`);
  
  server.close(async () => {
    // 3. Close worker connections to Redis cleanly
    await mailTemplateWorker.worker.close();
    await campaignMailWorker.worker.close();
    
    logger.info('Server and workers closed');
    process.exit(0);
  });
}

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise Rejection', { reason });
  server.close(() => process.exit(1));
});
