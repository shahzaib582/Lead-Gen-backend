const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  computeReplyMetrics,
  formatCampaignListItem,
} = require('../src/utils/campaignListMetrics');

describe('campaignListMetrics', () => {
  it('computeReplyMetrics returns zero rates when nothing sent', () => {
    const m = computeReplyMetrics(0, 0);
    assert.equal(m.sent_count, 0);
    assert.equal(m.reply_rate, 0);
    assert.equal(m.reply_rate_percent, 0);
  });

  it('computeReplyMetrics calculates rate from sent leads', () => {
    const m = computeReplyMetrics(10, 3);
    assert.equal(m.sent_count, 10);
    assert.equal(m.reply_rate, 0.3);
    assert.equal(m.reply_rate_percent, 30);
  });

  it('formatCampaignListItem returns only list fields', () => {
    const item = formatCampaignListItem(
      {
        id: 'a',
        name: 'Test',
        goal: 'Goal',
        run_mode: 'manual',
        target_leads: 50,
        status: 'active',
        extra: 'ignored',
      },
      { sent_count: 4, reply_count: 1 }
    );
    assert.equal(item.id, 'a');
    assert.equal(item.sent_count, 4);
    assert.equal(item.reply_rate_percent, 25);
    assert.equal(item.extra, undefined);
  });
});
