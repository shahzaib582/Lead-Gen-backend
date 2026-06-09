const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  toPublicPlan,
  toPublicSubscription,
  toQuotaUsage,
  toPublicUserQuota,
} = require('../src/utils/billingPublic');

describe('billingPublic', () => {
  it('maps plan row to camelCase', () => {
    const plan = toPublicPlan({
      id: 'growth',
      name: 'Growth',
      price_cents: 5000,
      currency: 'usd',
      billing_interval: 'month',
      max_campaigns: 15,
      max_leads_per_campaign: 500,
      sort_order: 2,
    });

    assert.equal(plan.id, 'growth');
    assert.equal(plan.priceCents, 5000);
    assert.equal(plan.maxCampaigns, 15);
    assert.equal(plan.maxLeadsPerCampaign, 500);
  });

  it('maps subscription with limits', () => {
    const sub = toPublicSubscription(
      {
        plan_id: 'starter',
        status: 'active',
        stripe_subscription_id: null,
        current_period_start: '2026-06-01T00:00:00.000Z',
        current_period_end: null,
        cancel_at_period_end: false,
        canceled_at: null,
      },
      {
        id: 'starter',
        name: 'Starter',
        price_cents: 0,
        currency: 'usd',
        billing_interval: 'month',
        max_campaigns: 5,
        max_leads_per_campaign: 100,
        sort_order: 1,
      }
    );

    assert.equal(sub.planId, 'starter');
    assert.equal(sub.status, 'active');
    assert.equal(sub.limits.maxCampaigns, 5);
    assert.equal(sub.limits.maxLeadsPerCampaign, 100);
  });

  it('computes quota usage with available headroom', () => {
    assert.deepEqual(toQuotaUsage(5, 2), { limit: 5, used: 2, available: 3 });
    assert.deepEqual(toQuotaUsage(100, 120), { limit: 100, used: 120, available: 0 });
  });

  it('maps user quota with per-campaign lead usage', () => {
    const quota = toPublicUserQuota({
      plan: {
        id: 'growth',
        name: 'Growth',
        price_cents: 1000,
        currency: 'usd',
        billing_interval: 'month',
        max_campaigns: 15,
        max_leads_per_campaign: 500,
        sort_order: 2,
      },
      campaignsUsed: 1,
      campaignLeadUsage: [
        { campaignId: 'c1', campaignName: 'Alpha', leadsUsed: 40 },
      ],
      dailyEmailsUsed: 25,
      dailyEmailLimit: 500,
    });

    assert.equal(quota.plan.id, 'growth');
    assert.deepEqual(quota.campaigns, { limit: 15, used: 1, available: 14 });
    assert.equal(quota.leadsPerCampaign.limit, 500);
    assert.equal(quota.leadsPerCampaign.campaigns[0].used, 40);
    assert.equal(quota.leadsPerCampaign.campaigns[0].available, 460);
    assert.deepEqual(quota.dailyEmails, { limit: 500, used: 25, available: 475 });
  });
});
