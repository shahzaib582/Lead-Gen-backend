const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { resolvePlanIdForLimits } = require('../src/services/planLimitService');

describe('planLimitService', () => {
  it('prefers active subscription plan over users.current_plan_id', () => {
    assert.equal(
      resolvePlanIdForLimits({
        subscription: { plan_id: 'pro', status: 'active' },
        currentPlanId: 'starter',
      }),
      'pro'
    );
  });

  it('uses current_plan_id when subscription is canceled', () => {
    assert.equal(
      resolvePlanIdForLimits({
        subscription: { plan_id: 'pro', status: 'canceled' },
        currentPlanId: 'starter',
      }),
      'starter'
    );
  });

  it('falls back to starter when no plan is set', () => {
    assert.equal(
      resolvePlanIdForLimits({
        subscription: null,
        currentPlanId: null,
      }),
      'starter'
    );
  });
});
