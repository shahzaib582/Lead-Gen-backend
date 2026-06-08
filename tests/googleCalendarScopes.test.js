const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  accountHasCalendarScope,
  accountCanWriteCalendar,
  CALENDAR_SCOPE_WRITE,
} = require('../src/utils/googleCalendarScopes');

describe('googleCalendarScopes', () => {
  it('detects calendar read or write scopes', () => {
    assert.equal(accountHasCalendarScope([CALENDAR_SCOPE_WRITE]), true);
    assert.equal(accountHasCalendarScope(['openid']), false);
  });

  it('requires write scope to create events', () => {
    assert.equal(
      accountCanWriteCalendar(['https://www.googleapis.com/auth/calendar.events.readonly']),
      false
    );
    assert.equal(accountCanWriteCalendar([CALENDAR_SCOPE_WRITE]), true);
  });
});
