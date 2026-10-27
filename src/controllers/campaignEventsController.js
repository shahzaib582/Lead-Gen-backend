const connection = require('../queues/connection');
const logger = require('../utils/logger');
const { successResponse, errorResponse } = require('../utils/response');
const {
  createSseSession,
  getSseSession,
  campaignChannel,
  getCampaignProgressSnapshot,
} = require('../services/campaignEventsPublisher');
const campaignService = require('../services/campaignService');

/**
 * POST /campaigns/:id/events/session — Bearer JWT; returns short-lived sid for EventSource.
 */
async function createEventsSession(req, res, next) {
  try {
    const campaignId = req.params.id;
    await campaignService.getCampaignById(req.user.id, campaignId);
    const { sid, expiresInSec } = await createSseSession(req.user.id, campaignId);
    return successResponse(res, 200, 'SSE session created.', {
      sid,
      expiresInSec,
      eventsUrl: `/api/campaigns/${campaignId}/events?sid=${encodeURIComponent(sid)}`,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /campaigns/:id/events?sid=… — Server-Sent Events stream (Redis pub/sub).
 */
async function streamCampaignEvents(req, res, next) {
  const campaignId = req.params.id;
  const sid = typeof req.query.sid === 'string' ? req.query.sid : '';

  const session = await getSseSession(sid);
  if (!session || session.campaignId !== campaignId) {
    return errorResponse(
      res,
      401,
      'Invalid or expired SSE session. POST /api/campaigns/:id/events/session first.'
    );
  }

  try {
    await campaignService.getCampaignById(session.userId, campaignId);
  } catch (err) {
    return next(err);
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const writeSse = (eventName, dataObj) => {
    const payload = typeof dataObj === 'string' ? dataObj : JSON.stringify(dataObj);
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${payload}\n\n`);
  };

  try {
    const snapshot = await getCampaignProgressSnapshot(session.userId, campaignId);
    writeSse('campaign_progress', { type: 'campaign_progress', ...snapshot, campaignId });
  } catch (err) {
    logger.warn('[SSE] initial snapshot failed', { err: err.message, campaignId });
    writeSse('campaign_progress', {
      type: 'campaign_progress',
      campaignId,
      byStatus: {},
      total: 0,
    });
  }

  const sub = connection.duplicate();
  const channel = campaignChannel(campaignId);

  const heartbeat = setInterval(() => {
    res.write(': ping\n\n');
  }, 15000);

  const cleanup = async () => {
    clearInterval(heartbeat);
    try {
      await sub.unsubscribe(channel);
      await sub.quit();
    } catch {
      // ignore
    }
  };

  req.on('close', () => {
    cleanup().catch(() => {});
  });

  sub.on('message', (ch, message) => {
    if (ch !== channel) return;
    try {
      const parsed = JSON.parse(message);
      const t = parsed.type || 'message';
      writeSse(t, parsed);
    } catch {
      writeSse('message', { raw: message });
    }
  });

  sub.on('error', (err) => {
    logger.error('[SSE] subscriber error', { err: err.message, campaignId });
  });

  try {
    await sub.subscribe(channel);
  } catch (err) {
    await cleanup();
    return next(err);
  }
}

module.exports = {
  createEventsSession,
  streamCampaignEvents,
};
