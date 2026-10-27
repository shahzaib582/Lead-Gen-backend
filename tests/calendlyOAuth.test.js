const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  generatePkcePair,
  createConnectState,
  verifyConnectState,
  getPublicWebhookUrl,
} = require('../src/config/calendlyOAuth');

describe('calendlyOAuth', () => {
  const prevJwt = process.env.JWT_ACCESS_SECRET;
  const prevPublic = process.env.PUBLIC_BASE_URL;

  before(() => {
    process.env.JWT_ACCESS_SECRET = 'test-calendly-oauth-secret-min-32-chars!!';
    process.env.PUBLIC_BASE_URL = 'https://api.example.com';
  });

  after(() => {
    if (prevJwt === undefined) delete process.env.JWT_ACCESS_SECRET;
    else process.env.JWT_ACCESS_SECRET = prevJwt;
    if (prevPublic === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = prevPublic;
  });

  it('generatePkcePair produces verifier and S256 challenge', () => {
    const { codeVerifier, codeChallenge } = generatePkcePair();
    assert.ok(codeVerifier.length >= 43);
    assert.ok(codeChallenge.length >= 43);
    assert.notEqual(codeVerifier, codeChallenge);
  });

  it('connect state round-trips userId and codeVerifier', () => {
    const userId = '11111111-1111-4111-8111-111111111111';
    const { codeVerifier } = generatePkcePair();
    const state = createConnectState(userId, codeVerifier);
    const parsed = verifyConnectState(state);
    assert.equal(parsed.userId, userId);
    assert.equal(parsed.codeVerifier, codeVerifier);
  });

  it('getPublicWebhookUrl includes platform user id', () => {
    const url = getPublicWebhookUrl('22222222-2222-4222-8222-222222222222');
    assert.equal(
      url,
      'https://api.example.com/api/calendly/webhooks/22222222-2222-4222-8222-222222222222'
    );
  });
});
