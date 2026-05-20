const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildThankYouBody } = require('../src/services/thankYouDraftService');

describe('thankYouDraft', () => {
  it('buildThankYouBody fills lead and sender placeholders', () => {
    const body = buildThankYouBody(
      { firstName: 'Sam', fullName: 'Sam Lee', email: 'sam@test.com' },
      'Alex',
    );
    assert.match(body, /Sam/);
    assert.match(body, /Alex/);
    assert.doesNotMatch(body, /\{\{firstName\}\}/i);
  });
});
