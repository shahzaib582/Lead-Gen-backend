const AppError = require('./AppError');

const MEETING_PAST_DATETIME_MSG = 'Cannot schedule meeting on past date/time.';
const MEETING_PAST_DATETIME_CODE = 'MEETING_PAST_DATETIME';

function assertMeetingStartNotInPast(startAt, now = new Date()) {
  const start = startAt instanceof Date ? startAt : new Date(startAt);
  if (Number.isNaN(start.getTime())) {
    throw new AppError('Invalid start_at.', 422);
  }
  if (start.getTime() < now.getTime()) {
    throw new AppError(MEETING_PAST_DATETIME_MSG, 422, MEETING_PAST_DATETIME_CODE);
  }
}

function isMeetingEndPast(endAt, now = new Date()) {
  const end = endAt instanceof Date ? endAt : new Date(endAt);
  if (Number.isNaN(end.getTime())) return false;
  return end.getTime() < now.getTime();
}

module.exports = {
  MEETING_PAST_DATETIME_MSG,
  MEETING_PAST_DATETIME_CODE,
  assertMeetingStartNotInPast,
  isMeetingEndPast,
};
