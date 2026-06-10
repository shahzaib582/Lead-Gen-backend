const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  createOpenTrackingToken,
  normalizeTrackingToken,
  getOpenTrackingPixelUrl,
  buildTrackedHtmlEmail,
} = require('../src/utils/emailOpenTracking');

describe('emailOpenTracking', () => {
  it('creates UUID tracking tokens', () => {
    const token = createOpenTrackingToken();
    assert.match(token, /^[0-9a-f-]{36}$/i);
  });

  it('normalizes token from .gif suffix', () => {
    const token = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    assert.equal(normalizeTrackingToken(`${token}.gif`), token);
    assert.equal(normalizeTrackingToken('not-a-token'), null);
  });

  it('builds pixel URL from PUBLIC_BASE_URL', () => {
    const prev = process.env.PUBLIC_BASE_URL;
    process.env.PUBLIC_BASE_URL = 'https://api.example.com';
    try {
      const url = getOpenTrackingPixelUrl('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
      assert.equal(
        url,
        'https://api.example.com/api/tracking/open/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.gif'
      );
    } finally {
      if (prev === undefined) delete process.env.PUBLIC_BASE_URL;
      else process.env.PUBLIC_BASE_URL = prev;
    }
  });

  it('embeds tracking pixel in HTML email body', () => {
    const token = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const html = buildTrackedHtmlEmail('Hello\nWorld', token);
    assert.match(html, /<img src="[^"]+\/api\/tracking\/open\//);
    assert.match(html, /Hello<br>/);
    assert.match(html, /World/);
  });
});
