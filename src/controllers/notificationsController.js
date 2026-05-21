const connection = require('../queues/connection');
const logger = require('../utils/logger');
const { successResponse, errorResponse } = require('../utils/response');
const notificationService = require('../services/notificationService');
const {
  createNotificationSseSession,
  getNotificationSseSession,
  userNotificationChannel,
} = require('../services/notificationEventsPublisher');

async function list(req, res, next) {
  try {
    const unreadOnly = req.query.unread === 'true' || req.query.unread === '1';
    const result = await notificationService.listNotifications(req.user.id, {
      page: req.query.page,
      limit: req.query.limit,
      unreadOnly,
    });
    return successResponse(res, 200, undefined, result);
  } catch (err) {
    next(err);
  }
}

async function unreadCount(req, res, next) {
  try {
    const result = await notificationService.getUnreadCount(req.user.id);
    return successResponse(res, 200, undefined, result);
  } catch (err) {
    next(err);
  }
}

async function markRead(req, res, next) {
  try {
    const row = await notificationService.markNotificationRead(req.user.id, req.params.id);
    return successResponse(res, 200, 'Notification marked as read.', { notification: row });
  } catch (err) {
    next(err);
  }
}

async function markAllRead(req, res, next) {
  try {
    const result = await notificationService.markAllNotificationsRead(req.user.id);
    return successResponse(res, 200, 'All notifications marked as read.', result);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /notifications/events/session — Bearer JWT; short-lived sid for EventSource.
 */
async function createEventsSession(req, res, next) {
  try {
    const { sid, expiresInSec } = await createNotificationSseSession(req.user.id);
    return successResponse(res, 200, 'SSE session created.', {
      sid,
      expiresInSec,
      eventsUrl: `/api/notifications/events?sid=${encodeURIComponent(sid)}`,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /notifications/events?sid=… — Server-Sent Events stream (Redis pub/sub).
 */
async function streamNotificationEvents(req, res, next) {
  const sid = typeof req.query.sid === 'string' ? req.query.sid : '';

  const session = await getNotificationSseSession(sid);
  if (!session) {
    return errorResponse(
      res,
      401,
      'Invalid or expired SSE session. POST /api/notifications/events/session first.'
    );
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

  const { unreadCount: initialUnread } = await notificationService.getUnreadCount(session.userId);
  writeSse('notifications_snapshot', {
    type: 'notifications_snapshot',
    unreadCount: initialUnread,
  });

  const sub = connection.duplicate();
  const channel = userNotificationChannel(session.userId);

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
    logger.error('[NotificationSSE] subscriber error', { err: err.message, userId: session.userId });
  });

  try {
    await sub.subscribe(channel);
  } catch (err) {
    await cleanup();
    return next(err);
  }
}

module.exports = {
  list,
  unreadCount,
  markRead,
  markAllRead,
  createEventsSession,
  streamNotificationEvents,
};
