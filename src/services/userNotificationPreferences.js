const supabase = require('../config/supabase');
const logger = require('../utils/logger');

/**
 * @returns {Promise<boolean|null>} true/false from DB, or null if lookup failed
 */
async function fetchNotificationsEnabled(userId) {
  const { data, error } = await supabase
    .from('users')
    .select('notifications_enabled')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    logger.warn('[Notifications] preference lookup failed', { userId, error: error.message });
    return null;
  }
  return data?.notifications_enabled !== false;
}

/** In-app notifications + SSE (fail open if DB error). */
async function isUserNotificationsEnabled(userId) {
  const enabled = await fetchNotificationsEnabled(userId);
  if (enabled === null) return true;
  return enabled;
}

/** FCM web push only when notifications_enabled is true (fail closed if DB error). */
async function isUserWebPushEnabled(userId) {
  const enabled = await fetchNotificationsEnabled(userId);
  if (enabled === null) return false;
  return enabled === true;
}

module.exports = {
  isUserNotificationsEnabled,
  isUserWebPushEnabled,
};
