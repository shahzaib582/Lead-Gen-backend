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

  it('finalizeOutboundBody does not duplicate an existing signature block', () => {
    const alreadySigned = [
      'Hi there,',
      '',
      'Quick note about your product.',
      '',
      'Hamza Ansari',
      'Codex, Lahore',
      '+92 300 1234567',
    ].join('\n');

    const out = finalizeOutboundBody(alreadySigned, campaign);
    assert.equal((out.match(/Hamza Ansari/g) || []).length, 1);
    assert.equal((out.match(/Codex, Lahore/g) || []).length, 1);
    assert.doesNotMatch(out, /\n--\n/);
  });

  it('finalizeOutboundBody strips duplicate -- signature from stored templates', () => {
    const doubled = [
      'Hi there,',
      '',
      'Hamza Ansari',
      'Codex, Lahore',
      '+92 300 1234567',
      '',
      '--',
      'Hamza Ansari',
      'Codex, Lahore',
      '+92 300 1234567',
    ].join('\n');

    const out = finalizeOutboundBody(doubled, campaign);
    assert.equal((out.match(/Hamza Ansari/g) || []).length, 1);
    assert.doesNotMatch(out, /\n--\n/);
  });
});
