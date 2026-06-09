const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  absoluteChange,
  percentChange,
  pointsChange,
  computeConversionPercent,
} = require('../src/utils/meetingStatsPeriods');

describe('meetingStatsPeriods', () => {
  it('absoluteChange for week-over-week', () => {
    assert.equal(absoluteChange(8, 5), 3);
  });

  it('percentChange for month-over-month', () => {
    assert.equal(percentChange(37, 33), 12.1);
  });

  it('percentChange returns null when prior month zero', () => {
    assert.equal(percentChange(5, 0), null);
  });

  it('pointsChange for conversion rate', () => {
    assert.equal(pointsChange(4.4, 3.8), 0.6);
  });

  it('computeConversionPercent', () => {
    assert.equal(computeConversionPercent(44, 1000), 4.4);
    assert.equal(computeConversionPercent(0, 0), 0);
  });
});
