const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const AppError = require('../src/utils/AppError');
const {
  assertMeetingStartNotInPast,
  isMeetingEndPast,
  MEETING_PAST_DATETIME_MSG,
  MEETING_PAST_DATETIME_CODE,
} = require('../src/utils/meetingScheduleRules');

describe('meetingScheduleRules', () => {
  const now = new Date('2026-06-03T12:00:00.000Z');

  it('rejects start_at in the past', () => {
    assert.throws(
      () => assertMeetingStartNotInPast('2026-06-02T12:00:00.000Z', now),
      (err) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 422);
        assert.equal(err.message, MEETING_PAST_DATETIME_MSG);
        assert.equal(err.code, MEETING_PAST_DATETIME_CODE);
        return true;
      }
    );
  });

  it('allows start_at in the future', () => {
    assert.doesNotThrow(() =>
      assertMeetingStartNotInPast('2026-06-04T12:00:00.000Z', now)
    );
  });

  it('detects when meeting end is in the past', () => {
    assert.equal(isMeetingEndPast('2026-06-02T12:00:00.000Z', now), true);
    assert.equal(isMeetingEndPast('2026-06-04T12:00:00.000Z', now), false);
  });
});
