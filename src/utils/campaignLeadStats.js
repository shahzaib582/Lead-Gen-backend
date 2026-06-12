const supabase = require('../config/supabase');

/** PostgREST default max rows per request. */
const PAGE_SIZE = 1000;

/**
 * Fetch all rows for a query, paging past the 1k PostgREST limit.
 * @param {() => import('@supabase/supabase-js').PostgrestFilterBuilder} buildQuery
 */
async function fetchAllPaginated(buildQuery) {
  const all = [];
  let offset = 0;

  while (true) {
    const { data, error } = await buildQuery().range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;

    const batch = data || [];
    all.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return all;
}

async function countCampaignLeads(userId, { campaignId, status, replyReceived, emailOpened } = {}) {
  let query = supabase
    .from('campaign_leads')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);

  if (campaignId) query = query.eq('campaign_id', campaignId);
  if (status) query = query.eq('status', status);
  if (replyReceived === true) query = query.eq('reply_received', true);
  if (emailOpened === true) query = query.eq('email_opened', true);

  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

/**
 * Per-campaign sent/reply counts for campaign list (exact; no row cap).
 */
async function fetchCampaignLeadStatsMap(userId, campaignIds) {
  const map = new Map();
  for (const id of campaignIds) {
    map.set(id, { sent_count: 0, reply_count: 0 });
  }
  if (!campaignIds.length) return map;

  await Promise.all(
    campaignIds.map(async (campaignId) => {
      let sent = 0;
      let reply_count = 0;

      try {
        [sent, reply_count] = await Promise.all([
          countCampaignLeads(userId, { campaignId, status: 'sent' }),
          countCampaignLeads(userId, { campaignId, replyReceived: true }),
        ]);
      } catch (err) {
        if (/reply_received|column/i.test(err.message || '')) {
          sent = await countCampaignLeads(userId, { campaignId, status: 'sent' });
        } else {
          throw err;
        }
      }

      map.set(campaignId, { sent_count: sent, reply_count });
    })
  );

  return map;
}

/**
 * Per-campaign totals for dashboard active campaigns (exact counts).
 */
async function fetchCampaignAggregateStatsMap(userId, campaignIds) {
  const map = new Map();
  for (const id of campaignIds) {
    map.set(id, { total_leads: 0, sent_count: 0, reply_count: 0 });
  }
  if (!campaignIds.length) return map;

  await Promise.all(
    campaignIds.map(async (campaignId) => {
      let total_leads = 0;
      let sent_count = 0;
      let reply_count = 0;

      try {
        [total_leads, sent_count, reply_count] = await Promise.all([
          countCampaignLeads(userId, { campaignId }),
          countCampaignLeads(userId, { campaignId, status: 'sent' }),
          countCampaignLeads(userId, { campaignId, replyReceived: true }),
        ]);
      } catch (err) {
        if (/reply_received|column/i.test(err.message || '')) {
          [total_leads, sent_count] = await Promise.all([
            countCampaignLeads(userId, { campaignId }),
            countCampaignLeads(userId, { campaignId, status: 'sent' }),
          ]);
        } else {
          throw err;
        }
      }

      map.set(campaignId, { total_leads, sent_count, reply_count });
    })
  );

  return map;
}

async function fetchUserLeadSummaryCounts(userId) {
  const countTotal = () =>
    supabase
      .from('campaign_leads')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);

  const countSent = () =>
    supabase
      .from('campaign_leads')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'sent');

  const countReplies = () =>
    supabase
      .from('campaign_leads')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('reply_received', true);

  const countOpens = () =>
    supabase
      .from('campaign_leads')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('email_opened', true);

  let totalLeads = 0;
  let sentCount = 0;
  let replyCount = 0;
  let openCount = 0;

  const [totalRes, sentRes, replyRes, openRes] = await Promise.all([
    countTotal(),
    countSent(),
    countReplies(),
    countOpens(),
  ]);

  if (totalRes.error) throw totalRes.error;
  if (sentRes.error) throw sentRes.error;

  totalLeads = totalRes.count ?? 0;
  sentCount = sentRes.count ?? 0;

  if (replyRes.error) {
    if (!/reply_received|column/i.test(replyRes.error.message || '')) throw replyRes.error;
  } else {
    replyCount = replyRes.count ?? 0;
  }

  if (openRes.error) {
    if (!/email_opened|column/i.test(openRes.error.message || '')) throw openRes.error;
  } else {
    openCount = openRes.count ?? 0;
  }

  return { totalLeads, sentCount, replyCount, openCount };
}

module.exports = {
  PAGE_SIZE,
  fetchAllPaginated,
  countCampaignLeads,
  fetchCampaignLeadStatsMap,
  fetchCampaignAggregateStatsMap,
  fetchUserLeadSummaryCounts,
};
