const supabase = require('../config/supabase');
const AppError = require('../utils/AppError');
const {
  resolveDashboardPeriod,
  buildUtcDateKeys,
  countByUtcDateKey,
  toDateKey,
} = require('../utils/dashboardDateRange');
const { getUtcWeekRange } = require('../utils/meetingStatsPeriods');
const {
  percentChange,
  pointsChange,
  absoluteChange,
  resolvePreviousPeriod,
  computeRatePercent,
} = require('../utils/analyticsPeriodCompare');
const { fetchAllPaginated } = require('../utils/campaignLeadStats');

const STATUS_UI = {
  active: 'Running',
  paused: 'Paused',
  draft: 'Draft',
  completed: 'Completed',
};

async function loadSentInRange(userId, fromIso, toIso) {
  const { data, error } = await supabase
    .from('campaign_leads')
    .select(
      'id, campaign_id, sent_at, reply_received, reply_received_at, email_opened, email_opened_at, status'
    )
    .eq('user_id', userId)
    .eq('status', 'sent')
    .not('sent_at', 'is', null)
    .gte('sent_at', fromIso)
    .lte('sent_at', toIso);

  if (error) {
    if (/email_opened|column/i.test(error.message)) {
      const { data: fallback, error: fallbackErr } = await supabase
        .from('campaign_leads')
        .select('id, campaign_id, sent_at, reply_received, reply_received_at, status')
        .eq('user_id', userId)
        .eq('status', 'sent')
        .not('sent_at', 'is', null)
        .gte('sent_at', fromIso)
        .lte('sent_at', toIso);
      if (fallbackErr) throw new AppError('Failed to load sent analytics.', 500);
      return fallback || [];
    }
    throw new AppError('Failed to load sent analytics.', 500);
  }
  return data || [];
}

async function loadRepliesInRange(userId, fromIso, toIso) {
  const { data, error } = await supabase
    .from('campaign_leads')
    .select('id, campaign_id, reply_received_at')
    .eq('user_id', userId)
    .eq('reply_received', true)
    .not('reply_received_at', 'is', null)
    .gte('reply_received_at', fromIso)
    .lte('reply_received_at', toIso);

  if (error) {
    if (/reply_received/i.test(error.message)) return [];
    throw new AppError('Failed to load reply analytics.', 500);
  }
  return data || [];
}

async function countMeetingsInRange(userId, fromIso, toIso) {
  const { count, error } = await supabase
    .from('meetings')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .neq('status', 'cancelled')
    .gte('created_at', fromIso)
    .lte('created_at', toIso);

  if (error) {
    if (/meetings|relation/i.test(error.message)) return 0;
    throw new AppError('Failed to load meeting analytics.', 500);
  }
  return count ?? 0;
}

async function computePeriodMetrics(userId, fromIso, toIso) {
  const [sentRows, replyRows, meetings] = await Promise.all([
    loadSentInRange(userId, fromIso, toIso),
    loadRepliesInRange(userId, fromIso, toIso),
    countMeetingsInRange(userId, fromIso, toIso),
  ]);

  const sentCount = sentRows.length;
  const replyCount = replyRows.length;
  const openCount = sentRows.filter((row) => row.email_opened === true).length;
  const replyRate = computeRatePercent(replyCount, sentCount);
  const openRate = computeRatePercent(openCount, sentCount);

  return {
    emails_sent: sentCount,
    replies_received: replyCount,
    reply_rate: replyRate.rate,
    reply_rate_percent: replyRate.rate_percent,
    opens_received: openCount,
    open_rate: openRate.rate,
    open_rate_percent: openRate.rate_percent,
    meetings_booked: meetings,
  };
}

// ─── 1. Overview KPIs (top cards) ─────────────────────────────────────────────

async function getAnalyticsOverview(userId, periodOptions) {
  const range = resolveDashboardPeriod(periodOptions);
  const prev = resolvePreviousPeriod(range);
  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();
  const prevFromIso = prev.from.toISOString();
  const prevToIso = prev.to.toISOString();

  const [current, previous] = await Promise.all([
    computePeriodMetrics(userId, fromIso, toIso),
    computePeriodMetrics(userId, prevFromIso, prevToIso),
  ]);

  return {
    period: range.period,
    from: range.fromKey,
    to: range.toKey,
    emails_sent: {
      count: current.emails_sent,
      vs_previous_period_percent: percentChange(current.emails_sent, previous.emails_sent),
    },
    open_rate: {
      percent: current.open_rate_percent,
      vs_previous_period_points: pointsChange(
        current.open_rate_percent,
        previous.open_rate_percent
      ),
      tracked: true,
    },
    reply_rate: {
      percent: current.reply_rate_percent,
      vs_previous_period_points: pointsChange(
        current.reply_rate_percent,
        previous.reply_rate_percent
      ),
    },
    meetings_booked: {
      count: current.meetings_booked,
      vs_previous_period: absoluteChange(current.meetings_booked, previous.meetings_booked),
    },
    meta: {
      previous_period: { from: prev.fromKey, to: prev.toKey },
    },
  };
}

// ─── 2. Campaign reply chart (multi-line) ─────────────────────────────────────

async function getAnalyticsCampaignChart(userId, periodOptions) {
  const range = resolveDashboardPeriod(periodOptions);
  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();

  const { data: campaigns, error: campErr } = await supabase
    .from('campaigns')
    .select('id, name')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (campErr) throw new AppError('Failed to load campaigns for chart.', 500);

  const replyRows = await loadRepliesInRange(userId, fromIso, toIso);
  const dateKeys = buildUtcDateKeys(range.from, range.to);
  const campaignMap = new Map((campaigns || []).map((c) => [c.id, c.name]));

  const countsByCampaignDate = new Map();
  for (const row of replyRows) {
    if (!row.campaign_id || !row.reply_received_at) continue;
    const date = toDateKey(row.reply_received_at);
    const key = `${row.campaign_id}:${date}`;
    countsByCampaignDate.set(key, (countsByCampaignDate.get(key) || 0) + 1);
  }

  const activeCampaignIds = new Set(replyRows.map((r) => r.campaign_id).filter(Boolean));
  const seriesCampaigns = (campaigns || []).filter(
    (c) => activeCampaignIds.has(c.id) || campaignMap.has(c.id)
  );

  const campaignsOut = (seriesCampaigns.length ? seriesCampaigns : campaigns || []).map((c) => {
    const points = dateKeys.map((date) => ({
      date,
      replies: countsByCampaignDate.get(`${c.id}:${date}`) || 0,
    }));
    const total = points.reduce((s, p) => s + p.replies, 0);
    return {
      campaign_id: c.id,
      campaign_name: c.name,
      total_replies: total,
      series: points,
    };
  });

  campaignsOut.sort((a, b) => b.total_replies - a.total_replies);

  return {
    period: range.period,
    from: range.fromKey,
    to: range.toKey,
    date_keys: dateKeys,
    campaigns: campaignsOut.filter((c) => c.total_replies > 0),
  };
}

// ─── 3. Campaign comparison table ─────────────────────────────────────────────

function buildCampaignComparisonRow(c, stats, meetingsByCampaign) {
  const s = stats.get(c.id) || { leads: 0, emails_sent: 0, replies: 0, opens: 0, reply_trend: [] };
  const replyRate = computeRatePercent(s.replies, s.emails_sent);
  const openRate = computeRatePercent(s.opens, s.emails_sent);
  const trendCounts = countByUtcDateKey(s.reply_trend);
  const sparkline = [...trendCounts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-14)
    .map(([, count]) => count);

  return {
    campaign_id: c.id,
    campaign_name: c.name,
    leads: s.leads,
    emails_sent: s.emails_sent,
    open_rate_percent: openRate.rate_percent,
    reply_rate_percent: replyRate.rate_percent,
    reply_sparkline: sparkline,
    meetings: meetingsByCampaign.get(c.id) || 0,
    status: c.status,
    status_label: STATUS_UI[c.status] || c.status,
  };
}

async function getAnalyticsCampaignComparison(userId, { page = 1, limit = 10 } = {}) {
  const safeLimit = Math.min(Math.max(limit, 1), 50);
  const safePage = Math.max(page, 1);
  const fromIdx = (safePage - 1) * safeLimit;
  const toIdx = safePage * safeLimit - 1;

  const [{ count: total, error: countErr }, { data: campaigns, error: listErr }] =
    await Promise.all([
      supabase.from('campaigns').select('id', { count: 'exact', head: true }).eq('user_id', userId),
      supabase
        .from('campaigns')
        .select('id, name, status')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .range(fromIdx, toIdx),
    ]);

  if (countErr || listErr) {
    throw new AppError('Failed to load campaign comparison.', 500);
  }

  const totalCount = total ?? 0;
  const pageCampaigns = campaigns || [];
  const campaignIds = pageCampaigns.map((c) => c.id);

  if (campaignIds.length === 0) {
    return {
      campaigns: [],
      pagination: {
        page: safePage,
        limit: safeLimit,
        total: totalCount,
        totalPages: Math.ceil(totalCount / safeLimit) || 0,
      },
    };
  }

  let leads;
  try {
    leads = await fetchAllPaginated(() =>
      supabase
        .from('campaign_leads')
        .select('campaign_id, status, reply_received, sent_at, reply_received_at, email_opened')
        .eq('user_id', userId)
        .in('campaign_id', campaignIds)
    );
  } catch {
    throw new AppError('Failed to load leads for comparison.', 500);
  }

  const { data: meetings, error: meetErr } = await supabase
    .from('meetings')
    .select('campaign_id')
    .eq('user_id', userId)
    .neq('status', 'cancelled')
    .in('campaign_id', campaignIds);

  const meetingsByCampaign = new Map();
  if (!meetErr) {
    for (const m of meetings || []) {
      if (!m.campaign_id) continue;
      meetingsByCampaign.set(m.campaign_id, (meetingsByCampaign.get(m.campaign_id) || 0) + 1);
    }
  }

  const stats = new Map();
  for (const row of leads || []) {
    if (!stats.has(row.campaign_id)) {
      stats.set(row.campaign_id, {
        leads: 0,
        emails_sent: 0,
        replies: 0,
        opens: 0,
        reply_trend: [],
      });
    }
    const s = stats.get(row.campaign_id);
    s.leads += 1;
    if (row.status === 'sent') {
      s.emails_sent += 1;
      if (row.reply_received) s.replies += 1;
      if (row.email_opened === true) s.opens += 1;
      if (row.reply_received_at) {
        s.reply_trend.push(toDateKey(row.reply_received_at));
      }
    }
  }

  const items = pageCampaigns.map((c) => buildCampaignComparisonRow(c, stats, meetingsByCampaign));

  return {
    campaigns: items,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total: totalCount,
      totalPages: Math.ceil(totalCount / safeLimit) || 0,
    },
  };
}

// ─── 4. Sent vs replies by week ───────────────────────────────────────────────

async function getAnalyticsSentVsReplies(userId, { weeks = 4 } = {}) {
  const safeWeeks = Math.min(Math.max(Number(weeks) || 4, 1), 12);
  const now = new Date();
  const buckets = [];

  for (let offset = -(safeWeeks - 1); offset <= 0; offset += 1) {
    const { from, to } = getUtcWeekRange(now, offset);
    buckets.push({
      label: offset === 0 ? `W${safeWeeks}` : `W${safeWeeks + offset}`,
      week_index: offset + safeWeeks,
      from: from.toISOString(),
      to: to.toISOString(),
      from_key: toDateKey(from),
      to_key: toDateKey(to),
    });
  }

  const results = await Promise.all(
    buckets.map(async (b) => {
      const [sent, replies] = await Promise.all([
        loadSentInRange(userId, b.from, b.to),
        loadRepliesInRange(userId, b.from, b.to),
      ]);
      return {
        label: b.label,
        from: b.from_key,
        to: b.to_key,
        sent: sent.length,
        replies: replies.length,
      };
    })
  );

  return {
    weeks: safeWeeks,
    series: results,
    totals: {
      sent: results.reduce((s, r) => s + r.sent, 0),
      replies: results.reduce((s, r) => s + r.replies, 0),
    },
  };
}

// ─── 5. Reply breakdown (donut / circle graph) ────────────────────────────────

async function getAnalyticsReplyBreakdown(userId, periodOptions) {
  const range = resolveDashboardPeriod(periodOptions);
  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();

  const [sentRows, replyRows, pipelineRows, failedRows] = await Promise.all([
    supabase
      .from('campaign_leads')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'sent')
      .eq('reply_received', false)
      .gte('sent_at', fromIso)
      .lte('sent_at', toIso),
    supabase
      .from('campaign_leads')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('reply_received', true)
      .gte('reply_received_at', fromIso)
      .lte('reply_received_at', toIso),
    supabase
      .from('campaign_leads')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .in('status', ['pending', 'template_generated'])
      .gte('created_at', fromIso)
      .lte('created_at', toIso),
    supabase
      .from('campaign_leads')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .in('status', ['failed', 'skipped'])
      .gte('updated_at', fromIso)
      .lte('updated_at', toIso),
  ]);

  const segments = [
    {
      key: 'replies_received',
      label: 'Replies received',
      count: replyRows.count ?? 0,
      color: '#2dd4bf',
    },
    {
      key: 'sent_awaiting_reply',
      label: 'Sent — awaiting reply',
      count: sentRows.count ?? 0,
      color: '#0d9488',
    },
    {
      key: 'in_pipeline',
      label: 'In pipeline (not sent)',
      count: pipelineRows.count ?? 0,
      color: '#64748b',
    },
    {
      key: 'failed_or_skipped',
      label: 'Failed / skipped',
      count: failedRows.count ?? 0,
      color: '#94a3b8',
    },
  ];

  const total = segments.reduce((s, seg) => s + seg.count, 0);
  const breakdown = segments.map((seg) => ({
    ...seg,
    percent: total > 0 ? Math.round((seg.count / total) * 1000) / 10 : 0,
  }));

  return {
    period: range.period,
    from: range.fromKey,
    to: range.toKey,
    total,
    segments: breakdown,
  };
}

module.exports = {
  getAnalyticsOverview,
  getAnalyticsCampaignChart,
  getAnalyticsCampaignComparison,
  getAnalyticsSentVsReplies,
  getAnalyticsReplyBreakdown,
};
