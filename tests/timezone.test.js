const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isValidIanaTimezone, resolveUserTimezone } = require('../src/utils/timezone');

describe('timezone utils', () => {
  it('accepts valid IANA timezones', () => {
    assert.equal(isValidIanaTimezone('America/New_York'), true);
    assert.equal(isValidIanaTimezone('UTC'), true);
  });

  it('rejects invalid timezones', () => {
    assert.equal(isValidIanaTimezone('Not/A_Zone'), false);
    assert.equal(isValidIanaTimezone(''), false);
  });

  it('resolveUserTimezone uses profile when set', () => {
    assert.equal(resolveUserTimezone({ timezone: 'Europe/London' }), 'Europe/London');
  });

  it('resolveUserTimezone falls back to UTC when missing', () => {
    assert.equal(resolveUserTimezone({}), 'UTC');
    assert.equal(resolveUserTimezone({ timezone: null }), 'UTC');
  });
});
