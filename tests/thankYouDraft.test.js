const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildThankYouBody } = require('../src/services/thankYouDraftService');

describe('thankYouDraft', () => {
  it('buildThankYouBody fills lead and sender placeholders', () => {
    const body = buildThankYouBody(
      { firstName: 'Sam', fullName: 'Sam Lee', email: 'sam@test.com' },
      'Alex'
    );
    assert.match(body, /Sam/);
    assert.match(body, /Alex/);
    assert.doesNotMatch(body, /\{\{firstName\}\}/i);
  });

  it('buildThankYouBody includes Calendly booking link when provided', () => {
    const body = buildThankYouBody(
      { firstName: 'Sam' },
      'Alex',
      'https://calendly.com/acme/30min?utm_content=lead-1'
    );
    assert.match(body, /calendly\.com\/acme\/30min/);
    assert.doesNotMatch(body, /\{\{bookingLink\}\}/i);
  });

  it('buildThankYouBody omits scheduling line when no booking link', () => {
    const body = buildThankYouBody({ firstName: 'Sam' }, 'Alex', '');
    assert.doesNotMatch(body, /schedule a call/i);
    assert.doesNotMatch(body, /\{\{bookingLink\}\}/i);
  });
});
