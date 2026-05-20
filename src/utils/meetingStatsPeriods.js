/**
 * UTC calendar periods for meeting stats (week = Monday–Sunday).
 */

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

/** Monday 00:00 UTC of the week containing `anchor`, plus `weekOffset` weeks (-1 = prior week). */
function getUtcWeekRange(anchor = new Date(), weekOffset = 0) {
  const day = anchor.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  const monday = startOfUtcDay(anchor);
  monday.setUTCDate(monday.getUTCDate() - daysSinceMonday + weekOffset * 7);
  const sunday = endOfUtcDay(monday);
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  return { from: monday, to: sunday };
}

/** Calendar month in UTC; monthOffset 0 = current month, -1 = previous full month. */
function getUtcMonthRange(anchor = new Date(), monthOffset = 0) {
  const y = anchor.getUTCFullYear();
  const m = anchor.getUTCMonth() + monthOffset;
  const from = new Date(Date.UTC(y, m, 1));
  const to = endOfUtcDay(new Date(Date.UTC(y, m + 1, 0)));
  return { from: startOfUtcDay(from), to };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

/** Absolute difference: current − previous (e.g. +3 vs last week). */
function absoluteChange(current, previous) {
  return (Number(current) || 0) - (Number(previous) || 0);
}

/**
 * Relative percent change vs previous period (e.g. 12 = 12% vs last month).
 * Returns null when previous is 0 and current > 0.
 */
function percentChange(current, previous) {
  const cur = Number(current) || 0;
  const prev = Number(previous) || 0;
  if (prev === 0) {
    if (cur === 0) return 0;
    return null;
  }
  return round1(((cur - prev) / prev) * 100);
}

/** Percentage-point change (e.g. conversion 4.4% vs 3.8% → 0.6). */
function pointsChange(current, previous) {
  return round1((Number(current) || 0) - (Number(previous) || 0));
}

function computeConversionPercent(meetingsCount, emailsSentCount) {
  const sent = Number(emailsSentCount) || 0;
  const meetings = Number(meetingsCount) || 0;
  if (sent <= 0) return 0;
  return round1((meetings / sent) * 100);
}

module.exports = {
  getUtcWeekRange,
  getUtcMonthRange,
  absoluteChange,
  percentChange,
  pointsChange,
  computeConversionPercent,
};
