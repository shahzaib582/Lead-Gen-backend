const supabase = require('../config/supabase');
const logger = require('../utils/logger');

const DAILY_SEND_LIMIT = 500;

async function getTodaySentCount(userId) {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const since = todayStart.toISOString();

  const campaignLeadsRes = await supabase
    .from('campaign_leads')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'sent')
    .gte('sent_at', since);

  if (campaignLeadsRes.error) {
    logger.warn('Failed to fetch today campaign_leads sent count', {
      userId,
      error: campaignLeadsRes.error.message,
    });
  }

  let followUpCount = 0;
  const { data: userLeadRows, error: leadIdsErr } = await supabase
    .from('campaign_leads')
    .select('id')
    .eq('user_id', userId);

  if (leadIdsErr) {
    logger.warn('Failed to fetch user campaign lead ids for follow-up count', {
      userId,
      error: leadIdsErr.message,
    });
  } else {
    const leadIds = (userLeadRows || []).map((r) => r.id);
    if (leadIds.length > 0) {
      const followUpsRes = await supabase
        .from('campaign_lead_follow_ups')
        .select('id', { count: 'exact', head: true })
        .in('campaign_lead_id', leadIds)
        .eq('status', 'sent')
        .gte('sent_at', since);

      if (followUpsRes.error) {
        logger.warn('Failed to fetch today follow-up sent count', {
          userId,
          error: followUpsRes.error.message,
        });
      } else {
        followUpCount = followUpsRes.count || 0;
      }
    }
  }

  return (campaignLeadsRes.count || 0) + followUpCount;
}

module.exports = { DAILY_SEND_LIMIT, getTodaySentCount };
