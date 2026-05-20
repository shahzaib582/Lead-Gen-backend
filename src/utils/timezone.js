/**
 * Validate IANA timezone string (e.g. America/New_York).
 */
function isValidIanaTimezone(tz) {
  if (tz == null || typeof tz !== 'string') return false;
  const trimmed = tz.trim();
  if (!trimmed || trimmed.length > 64) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: trimmed });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve timezone for calendar scheduling: user profile if set, else UTC.
 */
function resolveUserTimezone(user) {
  const tz = user?.timezone;
  if (tz && isValidIanaTimezone(tz)) return tz.trim();
  return 'UTC';
}

module.exports = { isValidIanaTimezone, resolveUserTimezone };
