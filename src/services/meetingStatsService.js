const supabase = require('../config/supabase');
const AppError = require('../utils/AppError');
const {
  getUtcWeekRange,
  getUtcMonthRange,
  absoluteChange,
  percentChange,
  pointsChange,
  computeConversionPercent,
} = require('../utils/meetingStatsPeriods');

async function countMeetingsBooked(userId, fromIso, toIso) {
  const { count, error } = await supabase
    .from('meetings')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .neq('status', 'cancelled')
    .gte('created_at', fromIso)
    .lte('created_at', toIso);

  if (error) {
    if (/meetings|relation|does not exist/i.test(error.message)) return 0;
    throw new AppError('Failed to load meeting stats.', 500);
  }
  return count ?? 0;
}

async function countEmailsSentInRange(userId, fromIso, toIso) {
  const { count, error } = await supabase
    .from('campaign_leads')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'sent')
    .not('sent_at', 'is', null)
    .gte('sent_at', fromIso)
    .lte('sent_at', toIso);

  if (error) {
    throw new AppError('Failed to load email stats for conversion.', 500);
  }
  return count ?? 0;
}

async function loadPeriodMetrics(userId, from, to) {
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const [meetings, emails_sent] = await Promise.all([
    countMeetingsBooked(userId, fromIso, toIso),
    countEmailsSentInRange(userId, fromIso, toIso),
  ]);
  return {
    meetings,
    emails_sent,
    conversion_rate_percent: computeConversionPercent(meetings, emails_sent),
  };
}

/**
 * Dashboard meeting KPIs with period-over-period comparisons.
 */
async function getMeetingStats(userId) {
  const thisWeek = getUtcWeekRange(new Date(), 0);
  const lastWeek = getUtcWeekRange(new Date(), -1);
  const thisMonth = getUtcMonthRange(new Date(), 0);
  const lastMonth = getUtcMonthRange(new Date(), -1);

  const [weekCur, weekPrev, monthCur, monthPrev] = await Promise.all([
    loadPeriodMetrics(userId, thisWeek.from, thisWeek.to),
    loadPeriodMetrics(userId, lastWeek.from, lastWeek.to),
    loadPeriodMetrics(userId, thisMonth.from, thisMonth.to),
    loadPeriodMetrics(userId, lastMonth.from, lastMonth.to),
  ]);

  return {
    meetings_this_week: {
      count: weekCur.meetings,
      vs_last_week: absoluteChange(weekCur.meetings, weekPrev.meetings),
    },
    meetings_this_month: {
      count: monthCur.meetings,
      vs_last_month_percent: percentChange(monthCur.meetings, monthPrev.meetings),
    },
    conversion_rate: {
      percent: monthCur.conversion_rate_percent,
      vs_last_month_points: pointsChange(
        monthCur.conversion_rate_percent,
        monthPrev.conversion_rate_percent,
      ),
    },
    periods: {
      this_week: {
        from: thisWeek.from.toISOString().slice(0, 10),
        to: thisWeek.to.toISOString().slice(0, 10),
      },
      last_week: {
        from: lastWeek.from.toISOString().slice(0, 10),
        to: lastWeek.to.toISOString().slice(0, 10),
      },
      this_month: {
        from: thisMonth.from.toISOString().slice(0, 10),
        to: thisMonth.to.toISOString().slice(0, 10),
      },
      last_month: {
        from: lastMonth.from.toISOString().slice(0, 10),
        to: lastMonth.to.toISOString().slice(0, 10),
      },
    },
    meta: {
      conversion_definition:
        'meetings booked (non-cancelled, by created_at) ÷ campaign emails sent (by sent_at) in the same calendar month, × 100',
    },
  };
}

module.exports = { getMeetingStats };
