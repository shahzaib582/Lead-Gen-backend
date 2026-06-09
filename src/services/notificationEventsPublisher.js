const crypto = require('crypto');
const connection = require('../queues/connection');
const logger = require('../utils/logger');

const CHANNEL_PREFIX = 'user_notifications:';
const CHANNEL_SUFFIX = ':v1';

function userNotificationChannel(userId) {
  return `${CHANNEL_PREFIX}${userId}${CHANNEL_SUFFIX}`;
}

/**
 * Publish a JSON event to all SSE subscribers for this user.
 *
 * @param {string} userId
 * @param {Record<string, unknown>} payload Must include `type` for clients.
 */
async function publishNotificationEvent(userId, payload) {
  if (!userId || !payload || typeof payload.type !== 'string') return;
  const channel = userNotificationChannel(userId);
  const message = JSON.stringify({ ...payload, userId, ts: new Date().toISOString() });
  try {
    await connection.publish(channel, message);
  } catch (err) {
    logger.error('[NotificationEvents] publish failed', { channel, err: err && err.message });
  }
}

function sseSessionKey(sid) {
  return `notification_sse:${sid}`;
}

function randomSid() {
  return crypto.randomBytes(24).toString('base64url');
}

const SESSION_TTL_SEC = 300;

/**
 * @returns {{ sid: string, expiresInSec: number }}
 */
async function createNotificationSseSession(userId) {
  const sid = randomSid();
  const key = sseSessionKey(sid);
  const payload = JSON.stringify({ userId });
  await connection.set(key, payload, 'EX', SESSION_TTL_SEC);
  return { sid, expiresInSec: SESSION_TTL_SEC };
}

async function getNotificationSseSession(sid) {
  if (!sid || typeof sid !== 'string') return null;
  const raw = await connection.get(sseSessionKey(sid));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.userId) return null;
    return parsed;
  } catch {
    return null;
  }
}

module.exports = {
  publishNotificationEvent,
  userNotificationChannel,
  createNotificationSseSession,
  getNotificationSseSession,
  SESSION_TTL_SEC,
};
