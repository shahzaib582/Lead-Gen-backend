const { getMessaging, isFirebaseConfigured } = require('../config/firebase');
const { buildNotificationDeepLink, fcmStringData } = require('../utils/fcmPushLink');
const pushSubscriptionService = require('./pushSubscriptionService');
const logger = require('../utils/logger');

const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

/**
 * Send FCM web push to all tokens registered for the user.
 * @param {string} userId
 * @param {Record<string, unknown>} notification Public notification shape
 */
async function sendWebPushForNotification(userId, notification) {
  if (!isFirebaseConfigured() || !notification) {
    return { sent: 0, failed: 0, skipped: true };
  }

  const messaging = getMessaging();
  if (!messaging) return { sent: 0, failed: 0, skipped: true };

  let tokens;
  try {
    tokens = await pushSubscriptionService.listFcmTokensForUser(userId);
  } catch (err) {
    logger.warn('[FCM] token list failed', { userId, error: err.message });
    return { sent: 0, failed: 0, skipped: true };
  }

  if (!tokens.length) return { sent: 0, failed: 0, skipped: true };

  const link = buildNotificationDeepLink(notification);
  const data = fcmStringData({
    type: notification.type,
    notificationId: notification.id,
    campaignId: notification.campaignId,
    campaignLeadId: notification.campaignLeadId,
    meetingId: notification.meetingId,
    link,
  });

  const baseMessage = {
    notification: {
      title: String(notification.title || 'Lead Gen'),
      body: notification.body ? String(notification.body) : '',
    },
    data,
    webpush: {
      fcmOptions: { link },
    },
  };

  const staleTokens = [];
  let sent = 0;
  let failed = 0;

  const batchSize = 500;
  for (let i = 0; i < tokens.length; i += batchSize) {
    const chunk = tokens.slice(i, i + batchSize);
    try {
      const response = await messaging.sendEachForMulticast({
        tokens: chunk,
        ...baseMessage,
      });

      sent += response.successCount;
      failed += response.failureCount;

      response.responses.forEach((res, idx) => {
        if (res.success) return;
        const code = res.error?.code;
        if (code && INVALID_TOKEN_CODES.has(code)) {
          staleTokens.push(chunk[idx]);
        } else {
          logger.warn('[FCM] send failed', {
            userId,
            code,
            message: res.error?.message,
          });
        }
      });
    } catch (err) {
      failed += chunk.length;
      logger.error('[FCM] multicast failed', { userId, error: err.message });
    }
  }

  if (staleTokens.length) {
    try {
      await pushSubscriptionService.removeFcmTokens(userId, staleTokens);
    } catch (err) {
      logger.warn('[FCM] stale token cleanup failed', { userId, error: err.message });
    }
  }

  if (sent > 0) {
    logger.info('[FCM] web push sent', { userId, sent, failed, notificationId: notification.id });
  }

  return { sent, failed, skipped: false };
}

module.exports = { sendWebPushForNotification, isFirebaseConfigured };
