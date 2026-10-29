const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { verifyCalendlyWebhookSignature } = require('../src/services/calendlyWebhookService');

describe('calendlyWebhookService', () => {
  it('verifyCalendlyWebhookSignature accepts valid signature', () => {
    const signingKey = 'test-signing-key';
    const rawBody = Buffer.from(JSON.stringify({ event: 'invitee.created' }), 'utf8');
    const t = Math.floor(Date.now() / 1000);
    const v1 = crypto.createHmac('sha256', signingKey).update(`${t}.${rawBody}`).digest('hex');
    const header = `t=${t},v1=${v1}`;

    assert.equal(verifyCalendlyWebhookSignature(rawBody, header, signingKey), true);
    assert.equal(verifyCalendlyWebhookSignature(rawBody, header, 'wrong-key'), false);
  });
});
