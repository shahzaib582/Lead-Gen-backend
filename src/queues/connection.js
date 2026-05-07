require('dotenv').config();
const IORedis = require('ioredis');

const connection = new IORedis(
  process.env.REDIS_URL || {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT || 6379),
  },
  {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  }
);

connection.on('connect', () => {
  console.log('[Redis] Connected');
});

connection.on('error', (err) => {
  console.error('[Redis] Error:', err.message);
});

module.exports = connection;