const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const AppError = require('../src/utils/AppError');
const {
  resolveDashboardPeriod,
  buildUtcDateKeys,
  buildTimeSeries,
  countByUtcDateKey,
} = require('../src/utils/dashboardDateRange');

describe('dashboardDateRange', () => {
  it('resolveDashboardPeriod defaults to last_30_days', () => {
    const range = resolveDashboardPeriod({});
    assert.equal(range.period, 'last_30_days');
    assert.ok(range.from <= range.to);
  });

  it('resolveDashboardPeriod supports last_month bounds', () => {
    const range = resolveDashboardPeriod({ period: 'last_month' });
    assert.equal(range.period, 'last_month');
    assert.ok(range.fromKey <= range.toKey);
  });

  it('resolveDashboardPeriod rejects custom without dates', () => {
    assert.throws(
      () => resolveDashboardPeriod({ period: 'custom' }),
      (err) => err instanceof AppError && err.statusCode === 400
    );
  });

  it('buildTimeSeries fills zero booking points', () => {
    const keys = ['2026-05-01', '2026-05-02'];
    const sent = countByUtcDateKey(['2026-05-01T10:00:00.000Z', '2026-05-01T12:00:00.000Z']);
    const replies = countByUtcDateKey(['2026-05-02T08:00:00.000Z']);
    const { series, totals } = buildTimeSeries(keys, sent, replies, new Map());
    assert.equal(series.length, 2);
    assert.equal(series[0].sent, 2);
    assert.equal(series[1].replies, 1);
    assert.equal(series[0].bookings, 0);
    assert.equal(totals.sent, 2);
    assert.equal(totals.replies, 1);
  });

  it('buildUtcDateKeys is inclusive', () => {
    const from = new Date('2026-05-01T00:00:00.000Z');
    const to = new Date('2026-05-03T00:00:00.000Z');
    const keys = buildUtcDateKeys(from, to);
    assert.deepEqual(keys, ['2026-05-01', '2026-05-02', '2026-05-03']);
  });
});
