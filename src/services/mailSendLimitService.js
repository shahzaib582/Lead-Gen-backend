const supabase = require('../config/supabase');
const AppError = require('../utils/AppError');
const DAILY_SEND_LIMIT = 500;

async function getTodaySentCount(userId) {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  // Includes in-flight and uncertain sends, so concurrent paths cannot overspend quota.
  const { count, error } = await supabase
    .from('outbound_deliveries')
    .select('delivery_key', { count: 'exact', head: true })
    .eq('user_id', userId)
    .neq('status', 'failed')
    .gte('attempted_at', since.toISOString());
  if (error) throw new AppError('Unable to load email quota.', 503);
  return count || 0;
}
module.exports = { DAILY_SEND_LIMIT, getTodaySentCount };
