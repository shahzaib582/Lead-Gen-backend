const CALENDAR_SCOPE_WRITE = 'https://www.googleapis.com/auth/calendar.events';
const CALENDAR_SCOPE_READ = 'https://www.googleapis.com/auth/calendar.events.readonly';

function accountHasCalendarScope(scopes) {
  const list = Array.isArray(scopes) ? scopes : [];
  return list.includes(CALENDAR_SCOPE_WRITE) || list.includes(CALENDAR_SCOPE_READ);
}

function accountCanWriteCalendar(scopes) {
  const list = Array.isArray(scopes) ? scopes : [];
  return list.includes(CALENDAR_SCOPE_WRITE);
}

module.exports = {
  CALENDAR_SCOPE_WRITE,
  CALENDAR_SCOPE_READ,
  accountHasCalendarScope,
  accountCanWriteCalendar,
};
