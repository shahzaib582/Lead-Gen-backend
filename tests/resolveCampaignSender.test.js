const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { resolveCampaignSender } = require('../src/utils/resolveCampaignSender');

describe('resolveCampaignSender', () => {
  const user = {
    name: 'Jibran Babar',
    address: 'User Street, Lahore',
    contact: '+92 333 0000000',
  };

  it('uses campaign fields when provided', () => {
    const out = resolveCampaignSender(
      {
        sender_display_name: 'Hamza Ansari',
        sender_address: 'Codex, Lahore',
        sender_phone: '+92 300 1111111',
      },
      user
    );
    assert.equal(out.sender_display_name, 'Hamza Ansari');
    assert.equal(out.sender_address, 'Codex, Lahore');
    assert.equal(out.sender_phone, '+92 300 1111111');
  });

  it('falls back to user profile when campaign fields empty', () => {
    const out = resolveCampaignSender(
      {
        sender_display_name: null,
        sender_address: '',
        sender_phone: undefined,
      },
      user
    );
    assert.equal(out.sender_display_name, 'Jibran Babar');
    assert.equal(out.sender_address, 'User Street, Lahore');
    assert.equal(out.sender_phone, '+92 333 0000000');
  });

  it('falls back per field (partial campaign)', () => {
    const out = resolveCampaignSender(
      {
        sender_display_name: 'Campaign Name Only',
        sender_address: null,
        sender_phone: null,
      },
      user
    );
    assert.equal(out.sender_display_name, 'Campaign Name Only');
    assert.equal(out.sender_address, 'User Street, Lahore');
    assert.equal(out.sender_phone, '+92 333 0000000');
  });
});
