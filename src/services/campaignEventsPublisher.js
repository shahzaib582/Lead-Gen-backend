const crypto = require('crypto');
const connection = require('../queues/connection');
const supabase = require('../config/supabase');
const logger = require('../utils/logger');

const CHANNEL_PREFIX = 'campaign:';
const CHANNEL_SUFFIX = ':v1';

function campaignChannel(campaignId) {
  return `${CHANNEL_PREFIX}${campaignId}${CHANNEL_SUFFIX}`;
}

/**
 * Publish a JSON event to all SSE subscribers for this campaign.
 * Safe to call from web or worker processes (uses shared Redis).
 *
 * @param {string} campaignId
 * @param {Record<string, unknown>} payload Must include `type` for clients.
 */
async function publishCampaignEvent(campaignId, payload) {
  if (!campaignId || !payload || typeof payload.type !== 'string') return;
  const channel = campaignChannel(campaignId);
  const message = JSON.stringify({ ...payload, campaignId, ts: new Date().toISOString() });
  try {
    await connection.publish(channel, message);
  } catch (err) {
    logger.error('[CampaignEvents] publish failed', { channel, err: err && err.message });
  }
}

function sseSessionKey(sid) {
  return `campaign_sse:${sid}`;
}

function randomSid() {
  return crypto.randomBytes(24).toString('base64url');
}

const SESSION_TTL_SEC = 300;

/**
 * @returns {{ sid: string, expiresInSec: number }}
 */
async function createSseSession(userId, campaignId) {
  const sid = randomSid();
  const key = sseSessionKey(sid);
  const payload = JSON.stringify({ userId, campaignId });
  await connection.set(key, payload, 'EX', SESSION_TTL_SEC);
  return { sid, expiresInSec: SESSION_TTL_SEC };
}

async function getSseSession(sid) {
  if (!sid || typeof sid !== 'string') return null;
  const raw = await connection.get(sseSessionKey(sid));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.userId || !parsed.campaignId) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Aggregate campaign_lead counts by status for SSE / progress payloads.
 */
async function getCampaignProgressSnapshot(userId, campaignId) {
  const { data, error } = await supabase
    .from('campaign_leads')
    .select('status')
    .eq('campaign_id', campaignId)
    .eq('user_id', userId);

  if (error || !data) {
    return { byStatus: {}, total: 0 };
  }

  const byStatus = {};
  for (const row of data) {
    const s = row.status || 'unknown';
    byStatus[s] = (byStatus[s] || 0) + 1;
  }
  return { byStatus, total: data.length };
}

module.exports = {
  publishCampaignEvent,
  campaignChannel,
  createSseSession,
  getSseSession,
  getCampaignProgressSnapshot,
  SESSION_TTL_SEC,
};
