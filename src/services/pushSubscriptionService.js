const supabase = require('../config/supabase');
const AppError = require('../utils/AppError');
const { isFirebaseConfigured } = require('../config/firebase');

function trimToken(token) {
  const s = String(token || '').trim();
  if (!s || s.length < 20) {
    throw new AppError('fcmToken is required and must be a valid FCM registration token.', 422);
  }
  return s;
}

async function registerFcmToken(userId, { fcmToken, deviceLabel = null }) {
  if (!isFirebaseConfigured()) {
    throw new AppError('Web push (FCM) is not configured on the server.', 503);
  }

  const token = trimToken(fcmToken);
  const label = deviceLabel ? String(deviceLabel).trim().slice(0, 120) : null;

  const { data, error } = await supabase
    .from('user_fcm_tokens')
    .upsert(
      {
        user_id: userId,
        fcm_token: token,
        device_label: label,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,fcm_token' }
    )
    .select('id, fcm_token, device_label, created_at, updated_at')
    .single();

  if (error) throw new AppError(error.message || 'Failed to register push token.', 500);
  return {
    id: data.id,
    deviceLabel: data.device_label,
    registeredAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

async function unregisterFcmToken(userId, fcmToken) {
  const token = trimToken(fcmToken);
  const { error } = await supabase
    .from('user_fcm_tokens')
    .delete()
    .eq('user_id', userId)
    .eq('fcm_token', token);

  if (error) throw new AppError(error.message || 'Failed to unregister push token.', 500);
}

async function listFcmTokensForUser(userId) {
  const { data, error } = await supabase
    .from('user_fcm_tokens')
    .select('fcm_token')
    .eq('user_id', userId);

  if (error) throw new AppError(error.message || 'Failed to load push tokens.', 500);
  return (data || []).map((r) => r.fcm_token);
}

async function removeFcmTokens(userId, tokens) {
  if (!tokens.length) return;
  const { error } = await supabase
    .from('user_fcm_tokens')
    .delete()
    .eq('user_id', userId)
    .in('fcm_token', tokens);

  if (error) {
    throw new AppError(error.message || 'Failed to remove invalid push tokens.', 500);
  }
}

async function getPushRegistrationSummary(userId) {
  const { count, error } = await supabase
    .from('user_fcm_tokens')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);

  if (error) throw new AppError(error.message || 'Failed to count push tokens.', 500);

  return {
    fcmConfigured: isFirebaseConfigured(),
    registeredDevices: count ?? 0,
  };
}

module.exports = {
  registerFcmToken,
  unregisterFcmToken,
  listFcmTokensForUser,
  removeFcmTokens,
  getPushRegistrationSummary,
};
