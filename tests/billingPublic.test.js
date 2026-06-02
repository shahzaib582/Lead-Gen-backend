const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { toPublicPlan, toPublicSubscription } = require('../src/utils/billingPublic');

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
});
