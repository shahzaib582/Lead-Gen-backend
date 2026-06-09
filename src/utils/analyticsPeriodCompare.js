const { startOfUtcDay, endOfUtcDay } = require('./meetingStatsPeriods');
const { toDateKey } = require('./dashboardDateRange');

function round1(n) {
  return Math.round(n * 10) / 10;
}

function percentChange(current, previous) {
  const cur = Number(current) || 0;
  const prev = Number(previous) || 0;
  if (prev === 0) return cur === 0 ? 0 : null;
  return round1(((cur - prev) / prev) * 100);
}

function pointsChange(current, previous) {
  return round1((Number(current) || 0) - (Number(previous) || 0));
}

function absoluteChange(current, previous) {
  return (Number(current) || 0) - (Number(previous) || 0);
}

/** Prior period of equal length ending the day before `range.from`. */
function resolvePreviousPeriod(range) {
  const fromMs = range.from.getTime();
  const spanMs = range.to.getTime() - fromMs + 1;
  const prevTo = endOfUtcDay(new Date(fromMs - 24 * 60 * 60 * 1000));
  const prevFrom = startOfUtcDay(new Date(prevTo.getTime() - spanMs + 1));

  return {
    from: prevFrom,
    to: prevTo,
    fromKey: toDateKey(prevFrom),
    toKey: toDateKey(prevTo),
  };
}

function computeRatePercent(numerator, denominator) {
  const d = Number(denominator) || 0;
  const n = Number(numerator) || 0;
  if (d <= 0) return { rate: 0, rate_percent: 0 };
  const rate = n / d;
  return {
    rate: Math.round(rate * 10000) / 10000,
    rate_percent: Math.round(rate * 1000) / 10,
  };
}

module.exports = {
  percentChange,
  pointsChange,
  absoluteChange,
  resolvePreviousPeriod,
  computeRatePercent,
};
