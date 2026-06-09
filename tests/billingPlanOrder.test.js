const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isUpgrade, isDowngrade, isPaidPlan, planRank } = require('../src/utils/billingPlanOrder');

describe('billingPlanOrder', () => {
  it('ranks plans starter < growth < pro', () => {
    assert.ok(planRank('starter') < planRank('growth'));
    assert.ok(planRank('growth') < planRank('pro'));
  });

  it('detects upgrade and downgrade', () => {
    assert.equal(isUpgrade('starter', 'growth'), true);
    assert.equal(isUpgrade('growth', 'pro'), true);
    assert.equal(isUpgrade('pro', 'growth'), false);

    assert.equal(isDowngrade('pro', 'growth'), true);
    assert.equal(isDowngrade('growth', 'starter'), true);
    assert.equal(isDowngrade('starter', 'growth'), false);
  });

  it('identifies paid plans', () => {
    assert.equal(isPaidPlan('starter'), false);
    assert.equal(isPaidPlan('growth'), true);
    assert.equal(isPaidPlan('pro'), true);
  });
});
