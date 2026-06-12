const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isAccessTokenFresh } = require('../src/services/googleAuthService');

describe('googleAccountStatus', () => {
  const now = Date.parse('2026-06-03T12:00:00.000Z');

  it('treats access token as fresh before expiry buffer', () => {
    assert.equal(isAccessTokenFresh('2026-06-03T12:05:00.000Z', now), true);
  });

  it('treats access token as expired after expiry (with buffer)', () => {
    assert.equal(isAccessTokenFresh('2026-05-22T23:21:24.352+00:00', now), false);
  });

  it('treats missing expiry as expired', () => {
    assert.equal(isAccessTokenFresh(null, now), false);
  });
});
