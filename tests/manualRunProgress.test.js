const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildManualRunProgressMeta,
  manualRunInterLeadDelayMs,
} = require('../src/utils/manualRunProgress');

describe('manualRunProgress', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    delete process.env.MANUAL_RUN_INSTANT_MAX_LEADS;
    delete process.env.MANUAL_RUN_BANNER_MIN_LEADS;
    delete process.env.MANUAL_RUN_SMALL_BATCH_GAP_MS;
    delete process.env.MAIL_DELAY_MIN_MS;
    delete process.env.MAIL_DELAY_MAX_MS;
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('uses fast batch for small lead counts', () => {
    const meta = buildManualRunProgressMeta(10);
    assert.equal(meta.batchMode, 'fast');
    assert.equal(meta.showProgressBanner, true);
    assert.equal(meta.delayBetweenEmailsSecondsMax, 2);
  });

  it('uses throttled batch and banner message for large counts', () => {
    const meta = buildManualRunProgressMeta(100);
    assert.equal(meta.batchMode, 'throttled');
    assert.equal(meta.showProgressBanner, true);
    assert.match(meta.userMessage, /Sending emails in batches/);
    assert.ok(meta.estimatedDurationMinutes > 100);
  });

  it('skips long delay between leads in fast batch', () => {
    assert.equal(manualRunInterLeadDelayMs(10, 0), 2000);
  });
});
