const supabase = require('../config/supabase');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { computeReplyMetrics } = require('../utils/campaignListMetrics');
const {
  resolveDashboardPeriod,
  buildUtcDateKeys,
  countByUtcDateKey,
  buildTimeSeries,
} = require('../utils/dashboardDateRange');
const {
  countScheduledMeetings,
  loadMeetingRowsInRange,
} = require('./meetingsService');

async function loadUserLeadRows(
  userId,
  { columns, extraFilter, fallbackEmptyOnMissingReply = false } = {}
) {
  let selectCols = columns;
  let query = supabase.from('campaign_leads').select(selectCols).eq('user_id', userId);

  if (extraFilter) query = extraFilter(query);

  let { data, error } = await query;

  if (error && /reply_received|column/i.test(`${error.message} ${error.details}`)) {
    if (fallbackEmptyOnMissingReply) {
      logger.warn('[Dashboard] reply_received columns unavailable — skipping reply metrics');
      return [];
    }
    selectCols = columns
      .split(',')
      .map((c) => c.trim())
      .filter((c) => !c.startsWith('reply_received'))
      .join(', ');
    query = supabase.from('campaign_leads').select(selectCols).eq('user_id', userId);
    if (extraFilter) query = extraFilter(query);
    ({ data, error } = await query);
  }

  if (error) {
    logger.error('[Dashboard] Failed to load campaign_leads', { error: error.message });
    throw new AppError('Failed to load dashboard metrics.', 500);
  }

  return data || [];
}

function aggregateStatsByCampaign(rows) {
  const map = new Map();

  for (const row of rows) {
    if (!map.has(row.campaign_id)) {
      map.set(row.campaign_id, { total_leads: 0, sent_count: 0, reply_count: 0 });
    }
    const stats = map.get(row.campaign_id);
    stats.total_leads += 1;
    if (row.status === 'sent') stats.sent_count += 1;
    if (row.reply_received === true) stats.reply_count += 1;
  }

  return map;
}

function computeProgressPercent(sentCount, totalLeads) {
  const total = Number(totalLeads) || 0;
  const sent = Number(sentCount) || 0;
  if (total <= 0) return 0;
  return Math.min(100, Math.round((sent / total) * 1000) / 10);
}

// ─── 1. Summary ───────────────────────────────────────────────────────────────

async function getDashboardSummary(userId) {
  const [{ count: totalCampaigns, error: campErr }, leadRows, meetingBookingCount] =
    await Promise.all([
      supabase
        .from('campaigns')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId),
      loadUserLeadRows(userId, { columns: 'status, reply_received' }),
      countScheduledMeetings(userId),
    ]);

  if (campErr) throw new AppError('Failed to load dashboard summary.', 500);

  let sentCount = 0;
  let replyCount = 0;
  for (const row of leadRows) {
    if (row.status === 'sent') sentCount += 1;
    if (row.reply_received === true) replyCount += 1;
  }

  const reply = computeReplyMetrics(sentCount, replyCount);

  return {
    total_campaigns: totalCampaigns ?? 0,
    total_leads: leadRows.length,
    total_emails_sent: sentCount,
    reply_rate: reply.reply_rate,
    reply_rate_percent: reply.reply_rate_percent,
    meeting_booking_count: meetingBookingCount,
  };
}

// ─── 2. Performance chart ─────────────────────────────────────────────────────

async function getDashboardPerformance(userId, periodOptions) {
  const range = resolveDashboardPeriod(periodOptions);
  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();

  const [sentRows, replyRows, meetingRows] = await Promise.all([
    loadUserLeadRows(userId, {
      columns: 'sent_at',
      extraFilter: (q) =>
        q
          .eq('status', 'sent')
          .not('sent_at', 'is', null)
          .gte('sent_at', fromIso)
          .lte('sent_at', toIso),
    }),
    loadUserLeadRows(userId, {
      columns: 'reply_received_at',
      fallbackEmptyOnMissingReply: true,
      extraFilter: (q) =>
        q
          .eq('reply_received', true)
          .not('reply_received_at', 'is', null)
          .gte('reply_received_at', fromIso)
          .lte('reply_received_at', toIso),
    }),
    loadMeetingRowsInRange(userId, fromIso, toIso),
  ]);

  const dateKeys = buildUtcDateKeys(range.from, range.to);
  const sentCounts = countByUtcDateKey(sentRows.map((r) => r.sent_at));
  const replyCounts = countByUtcDateKey(replyRows.map((r) => r.reply_received_at));
  const bookingCounts = countByUtcDateKey(meetingRows.map((r) => r.start_at));

  const { series, totals } = buildTimeSeries(dateKeys, sentCounts, replyCounts, bookingCounts);

  return {
    period: range.period,
    from: range.fromKey,
    to: range.toKey,
    series,
    totals,
  };
}

// ─── 3. Active campaigns ──────────────────────────────────────────────────────

async function getDashboardActiveCampaigns(userId, { page = 1, limit = 10 } = {}) {
  const safeLimit = Math.min(Math.max(limit, 1), 50);
  const safePage = Math.max(page, 1);

  const [{ count: totalRunning, error: countErr }, { data: campaigns, error: listErr }] =
    await Promise.all([
      supabase
        .from('campaigns')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'active'),
      supabase
        .from('campaigns')
        .select('id, name, status, target_leads')
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('updated_at', { ascending: false })
        .range((safePage - 1) * safeLimit, safePage * safeLimit - 1),
    ]);

  if (countErr || listErr) {
    throw new AppError('Failed to load active campaigns.', 500);
  }

  const campaignIds = (campaigns || []).map((c) => c.id);
  const leadRows = campaignIds.length
    ? await loadUserLeadRows(userId, {
        columns: 'campaign_id, status, reply_received',
        extraFilter: (q) => q.in('campaign_id', campaignIds),
      })
    : [];

  const statsMap = aggregateStatsByCampaign(leadRows);

  const items = (campaigns || []).map((c) => {
    const stats = statsMap.get(c.id) || { total_leads: 0, sent_count: 0, reply_count: 0 };
    return {
      id: c.id,
      name: c.name,
      status: c.status,
      total_leads: stats.total_leads,
      sent_count: stats.sent_count,
      reply_count: stats.reply_count,
      progress: computeProgressPercent(stats.sent_count, stats.total_leads),
    };
  });

  return {
    total_running: totalRunning ?? 0,
    campaigns: items,
    page: safePage,
    limit: safeLimit,
    total: totalRunning ?? 0,
    totalPages: Math.ceil((totalRunning ?? 0) / safeLimit) || 0,
  };
}

// ─── 4. Recent activity ───────────────────────────────────────────────────────

async function fetchRecentFollowUpEvents(userId, fetchLimit) {
  const { data: leads, error: leadsErr } = await supabase
    .from('campaign_leads')
    .select('id, campaign_id')
    .eq('user_id', userId);

  if (leadsErr || !leads?.length) return [];

  const leadIds = leads.map((l) => l.id);
  const leadToCampaign = new Map(leads.map((l) => [l.id, l.campaign_id]));

  const { data: deliveries, error: delErr } = await supabase
    .from('campaign_lead_follow_ups')
    .select('campaign_lead_id, sent_at, follow_up_id')
    .eq('status', 'sent')
    .not('sent_at', 'is', null)
    .in('campaign_lead_id', leadIds)
    .order('sent_at', { ascending: false })
    .limit(fetchLimit);

  if (delErr) {
    logger.warn('[Dashboard] Failed to load follow-up activity', { error: delErr.message });
    return [];
  }

  return (deliveries || []).map((d) => ({
    type: 'follow_up_sent',
    campaign_id: leadToCampaign.get(d.campaign_lead_id),
    campaign_lead_id: d.campaign_lead_id,
    occurred_at: d.sent_at,
    meta: { follow_up_id: d.follow_up_id },
  }));
}

async function getDashboardRecentActivity(userId, { page = 1, limit = 20 } = {}) {
  const safeLimit = Math.min(Math.max(limit, 1), 50);
  const safePage = Math.max(page, 1);
  const fetchLimit = Math.min(safePage * safeLimit + safeLimit, 200);

  const [sentLeads, replyLeads, followUps] = await Promise.all([
    loadUserLeadRows(userId, {
      columns: 'id, campaign_id, sent_at, lead_data_id',
      extraFilter: (q) =>
        q
          .eq('status', 'sent')
          .not('sent_at', 'is', null)
          .order('sent_at', { ascending: false })
          .limit(fetchLimit),
    }),
    loadUserLeadRows(userId, {
      columns: 'id, campaign_id, reply_received_at, lead_data_id',
      fallbackEmptyOnMissingReply: true,
      extraFilter: (q) =>
        q
          .eq('reply_received', true)
          .not('reply_received_at', 'is', null)
          .order('reply_received_at', { ascending: false })
          .limit(fetchLimit),
    }),
    fetchRecentFollowUpEvents(userId, fetchLimit),
  ]);

  const events = [];

  for (const row of sentLeads) {
    events.push({
      id: `sent-${row.id}`,
      type: 'email_sent',
      campaign_id: row.campaign_id,
      campaign_lead_id: row.id,
      lead_data_id: row.lead_data_id,
      occurred_at: row.sent_at,
      title: 'Email sent',
    });
  }

  for (const row of replyLeads) {
    events.push({
      id: `reply-${row.id}`,
      type: 'reply_received',
      campaign_id: row.campaign_id,
      campaign_lead_id: row.id,
      lead_data_id: row.lead_data_id,
      occurred_at: row.reply_received_at,
      title: 'Reply received',
    });
  }

  for (const row of followUps) {
    events.push({
      id: `followup-${row.campaign_lead_id}-${row.meta.follow_up_id}`,
      type: 'follow_up_sent',
      campaign_id: row.campaign_id,
      campaign_lead_id: row.campaign_lead_id,
      occurred_at: row.occurred_at,
      title: 'Follow-up sent',
    });
  }

  events.sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at));

  const campaignIds = [...new Set(events.map((e) => e.campaign_id).filter(Boolean))];
  const nameByCampaign = new Map();

  if (campaignIds.length) {
    const { data: camps } = await supabase
      .from('campaigns')
      .select('id, name')
      .eq('user_id', userId)
      .in('id', campaignIds);
    for (const c of camps || []) {
      nameByCampaign.set(c.id, c.name);
    }
  }

  const enriched = events.map((e) => ({
    ...e,
    campaign_name: nameByCampaign.get(e.campaign_id) || null,
  }));

  const total = enriched.length;
  const start = (safePage - 1) * safeLimit;
  const items = enriched.slice(start, start + safeLimit);

  return {
    activities: items,
    page: safePage,
    limit: safeLimit,
    total,
    totalPages: Math.ceil(total / safeLimit) || 0,
  };
}

const { getMeetingStats } = require('./meetingStatsService');

module.exports = {
  getMeetingStats,
  getDashboardSummary,
  getDashboardPerformance,
  getDashboardActiveCampaigns,
  getDashboardRecentActivity,
};
