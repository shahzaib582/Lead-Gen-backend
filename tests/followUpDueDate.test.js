const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  computeFollowUpDueAt,
  isFollowUpDue,
} = require('../src/utils/followUpDueDate');

describe('followUpDueDate', () => {
  const initialSentAt = '2026-05-10T12:00:00.000Z';

  it('computeFollowUpDueAt adds calendar days in UTC', () => {
    const due = computeFollowUpDueAt(initialSentAt, 1);
    assert.equal(due.toISOString(), '2026-05-11T12:00:00.000Z');
  });

  it('isFollowUpDue is false before waiting period elapses', () => {
    const now = new Date('2026-05-11T11:59:59.000Z');
    assert.equal(isFollowUpDue(initialSentAt, 1, now), false);
  });

  it('isFollowUpDue is true when waiting period has elapsed', () => {
    const now = new Date('2026-05-11T12:00:00.000Z');
    assert.equal(isFollowUpDue(initialSentAt, 1, now), true);
  });

  it('supports multiple follow-up offsets from same initial sent_at', () => {
    const now = new Date('2026-05-13T12:00:00.000Z');
    assert.equal(isFollowUpDue(initialSentAt, 1, now), true);
    assert.equal(isFollowUpDue(initialSentAt, 3, now), true);
    assert.equal(isFollowUpDue(initialSentAt, 4, now), false);
  });

  it('waiting_days 0 is due immediately at sent time', () => {
    const now = new Date(initialSentAt);
    assert.equal(isFollowUpDue(initialSentAt, 0, now), true);
  });
});
