const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  applySenderPlaceholders,
  appendCampaignSignature,
  finalizeOutboundBody,
} = require('../src/utils/senderSignature');

describe('senderSignature', () => {
  const campaign = {
    sender_display_name: 'Hamza Ansari',
    sender_address: 'Codex, Lahore',
    sender_phone: '+92 300 1234567',
  };

  it('replaces [Your Name] with sender_display_name', () => {
    const out = applySenderPlaceholders('Best regards,\n[Your Name]', campaign);
    assert.match(out, /Hamza Ansari/);
    assert.doesNotMatch(out, /\[Your Name\]/);
  });

  it('appendCampaignSignature includes name, address, and phone', () => {
    const out = appendCampaignSignature('Body text', campaign);
    assert.match(out, /Hamza Ansari/);
    assert.match(out, /Codex, Lahore/);
    assert.match(out, /\+92 300 1234567/);
  });

  it('finalizeOutboundBody applies both', () => {
    const out = finalizeOutboundBody('Thanks,\n[Your Name]', campaign);
    assert.match(out, /Hamza Ansari/);
    assert.match(out, /Codex, Lahore/);
  });
});
