const AppError = require('./AppError');

const PERIOD_PRESETS = new Set([
  'last_7_days',
  'last_30_days',
  'last_month',
  'last_90_days',
  'this_month',
  'custom',
]);

function startOfUtcDay(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function endOfUtcDay(date) {
  const d = new Date(date);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

function toDateKey(isoOrDate) {
  return new Date(isoOrDate).toISOString().slice(0, 10);
}

/**
 * @returns {{ period: string, from: Date, to: Date, fromKey: string, toKey: string }}
 */
function resolveDashboardPeriod({ period = 'last_30_days', from, to } = {}) {
  const preset = PERIOD_PRESETS.has(period) ? period : 'last_30_days';
  const now = new Date();

  if (preset === 'custom') {
    if (!from || !to) {
      throw new AppError('Custom period requires `from` and `to` query params (YYYY-MM-DD).', 400);
    }
    const fromDate = startOfUtcDay(new Date(from));
    const toDate = endOfUtcDay(new Date(to));
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      throw new AppError('Invalid `from` or `to` date.', 400);
    }
    if (fromDate > toDate) {
      throw new AppError('`from` must be on or before `to`.', 400);
    }
    const maxSpanMs = 366 * 24 * 60 * 60 * 1000;
    if (toDate.getTime() - fromDate.getTime() > maxSpanMs) {
      throw new AppError('Date range cannot exceed 366 days.', 400);
    }
    return {
      period: preset,
      from: fromDate,
      to: toDate,
      fromKey: toDateKey(fromDate),
      toKey: toDateKey(toDate),
    };
  }

  let fromDate;
  let toDate = endOfUtcDay(now);

  switch (preset) {
    case 'last_7_days':
      fromDate = startOfUtcDay(now);
      fromDate.setUTCDate(fromDate.getUTCDate() - 6);
      break;
    case 'last_30_days':
      fromDate = startOfUtcDay(now);
      fromDate.setUTCDate(fromDate.getUTCDate() - 29);
      break;
    case 'last_90_days':
      fromDate = startOfUtcDay(now);
      fromDate.setUTCDate(fromDate.getUTCDate() - 89);
      break;
    case 'this_month':
      fromDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      break;
    case 'last_month': {
      const y = now.getUTCFullYear();
      const m = now.getUTCMonth();
      fromDate = new Date(Date.UTC(m === 0 ? y - 1 : y, m === 0 ? 11 : m - 1, 1));
      toDate = endOfUtcDay(new Date(Date.UTC(y, m, 0)));
      break;
    }
    default:
      fromDate = startOfUtcDay(now);
      fromDate.setUTCDate(fromDate.getUTCDate() - 29);
  }

  return {
    period: preset,
    from: fromDate,
    to: toDate,
    fromKey: toDateKey(fromDate),
    toKey: toDateKey(toDate),
  };
}

/** Inclusive UTC date keys from `from` through `to`. */
function buildUtcDateKeys(fromDate, toDate) {
  const keys = [];
  const cursor = startOfUtcDay(fromDate);
  const end = startOfUtcDay(toDate);

  while (cursor <= end) {
    keys.push(toDateKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return keys;
}

function countByUtcDateKey(timestamps) {
  const counts = new Map();
  for (const ts of timestamps || []) {
    if (!ts) continue;
    const key = toDateKey(ts);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function buildTimeSeries(dateKeys, sentCounts, replyCounts, bookingCounts) {
  let sentTotal = 0;
  let repliesTotal = 0;
  let bookingsTotal = 0;

  const series = dateKeys.map((date) => {
    const sent = sentCounts.get(date) || 0;
    const replies = replyCounts.get(date) || 0;
    const bookings = bookingCounts.get(date) || 0;
    sentTotal += sent;
    repliesTotal += replies;
    bookingsTotal += bookings;
    return { date, sent, replies, bookings };
  });

  return {
    series,
    totals: {
      sent: sentTotal,
      replies: repliesTotal,
      bookings: bookingsTotal,
    },
  };
}

module.exports = {
  PERIOD_PRESETS,
  resolveDashboardPeriod,
  buildUtcDateKeys,
  countByUtcDateKey,
  buildTimeSeries,
  toDateKey,
};
