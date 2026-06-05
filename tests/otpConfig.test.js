const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  getOtpExpiryMinutes,
  getOtpEmailBufferMinutes,
  getOtpStoredExpiryMs,
} = require('../src/config/otp');

describe('otp config', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    delete process.env.OTP_EXPIRY_MINUTES;
    delete process.env.OTP_EMAIL_BUFFER_MINUTES;
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('defaults display expiry to 10 minutes', () => {
    assert.equal(getOtpExpiryMinutes(), 10);
  });

  it('defaults email buffer to 5 minutes', () => {
    assert.equal(getOtpEmailBufferMinutes(), 5);
  });

  it('stores expiry with display + buffer minutes', () => {
    process.env.OTP_EXPIRY_MINUTES = '10';
    process.env.OTP_EMAIL_BUFFER_MINUTES = '5';
    const now = Date.parse('2026-06-03T12:00:00.000Z');
    const stored = getOtpStoredExpiryMs(now);
    assert.equal(stored, now + 15 * 60 * 1000);
  });

  it('respects custom env values', () => {
    process.env.OTP_EXPIRY_MINUTES = '10';
    process.env.OTP_EMAIL_BUFFER_MINUTES = '8';
    const now = Date.parse('2026-06-03T12:00:00.000Z');
    assert.equal(getOtpStoredExpiryMs(now), now + 18 * 60 * 1000);
  });
});
