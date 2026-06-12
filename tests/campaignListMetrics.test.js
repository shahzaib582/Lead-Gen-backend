const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  computeReplyMetrics,
  formatCampaignLeadCounts,
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

  it('formatCampaignLeadCounts includes lead status totals', () => {
    const counts = formatCampaignLeadCounts({
      total_leads: 100,
      pending_count: 40,
      failed_count: 6,
      sent_count: 50,
      reply_count: 5,
    });
    assert.equal(counts.total_leads, 100);
    assert.equal(counts.pending_count, 40);
    assert.equal(counts.failed_count, 6);
    assert.equal(counts.sent_count, 50);
    assert.equal(counts.reply_rate_percent, 10);
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
      {
        total_leads: 10,
        pending_count: 3,
        failed_count: 1,
        sent_count: 4,
        reply_count: 1,
      }
    );
    assert.equal(item.id, 'a');
    assert.equal(item.total_leads, 10);
    assert.equal(item.pending_count, 3);
    assert.equal(item.failed_count, 1);
    assert.equal(item.sent_count, 4);
    assert.equal(item.reply_rate_percent, 25);
    assert.equal(item.extra, undefined);
  });
});
