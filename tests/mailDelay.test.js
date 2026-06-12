const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

describe('mailDelay', () => {
  const saved = {};

  beforeEach(() => {
    saved.MAIL_DELAY_MIN_MS = process.env.MAIL_DELAY_MIN_MS;
    saved.MAIL_DELAY_MAX_MS = process.env.MAIL_DELAY_MAX_MS;
    delete process.env.MAIL_DELAY_MIN_MS;
    delete process.env.MAIL_DELAY_MAX_MS;
    delete require.cache[require.resolve('../src/config/mailDelay')];
  });

  afterEach(() => {
    if (saved.MAIL_DELAY_MIN_MS === undefined) delete process.env.MAIL_DELAY_MIN_MS;
    else process.env.MAIL_DELAY_MIN_MS = saved.MAIL_DELAY_MIN_MS;
    if (saved.MAIL_DELAY_MAX_MS === undefined) delete process.env.MAIL_DELAY_MAX_MS;
    else process.env.MAIL_DELAY_MAX_MS = saved.MAIL_DELAY_MAX_MS;
  });

  it('getMailDelayBoundsMs uses defaults when env unset', () => {
    const {
      getMailDelayBoundsMs,
      DEFAULT_MIN_MS,
      DEFAULT_MAX_MS,
    } = require('../src/config/mailDelay');
    const { minMs, maxMs } = getMailDelayBoundsMs();
    assert.equal(minMs, DEFAULT_MIN_MS);
    assert.equal(maxMs, DEFAULT_MAX_MS);
  });

  it('getMailDelayBoundsMs reads env when valid', () => {
    process.env.MAIL_DELAY_MIN_MS = '1000';
    process.env.MAIL_DELAY_MAX_MS = '2000';
    delete require.cache[require.resolve('../src/config/mailDelay')];
    const { getMailDelayBoundsMs } = require('../src/config/mailDelay');
    const { minMs, maxMs } = getMailDelayBoundsMs();
    assert.equal(minMs, 1000);
    assert.equal(maxMs, 2000);
  });

  it('randomDelayMs stays within bounds', () => {
    process.env.MAIL_DELAY_MIN_MS = '10';
    process.env.MAIL_DELAY_MAX_MS = '20';
    delete require.cache[require.resolve('../src/config/mailDelay')];
    const { randomDelayMs } = require('../src/config/mailDelay');
    for (let i = 0; i < 50; i++) {
      const ms = randomDelayMs();
      assert.ok(ms >= 10 && ms <= 20);
    }
  });
});
