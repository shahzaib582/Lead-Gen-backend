const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const AppError = require('../src/utils/AppError');
const {
  assertCampaignActiveForSend,
  isCampaignActiveForSend,
} = require('../src/services/campaignSendRules');

describe('campaignSendRules', () => {
  it('isCampaignActiveForSend returns true only for active', () => {
    assert.equal(isCampaignActiveForSend({ status: 'active' }), true);
    assert.equal(isCampaignActiveForSend({ status: 'paused' }), false);
    assert.equal(isCampaignActiveForSend({ status: 'draft' }), false);
    assert.equal(isCampaignActiveForSend(null), false);
  });

  it('assertCampaignActiveForSend throws CAMPAIGN_NOT_ACTIVE when not active', () => {
    assert.throws(
      () => assertCampaignActiveForSend({ status: 'paused' }),
      (err) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, 'CAMPAIGN_NOT_ACTIVE');
        return true;
      }
    );
  });

  it('assertCampaignActiveForSend passes for active', () => {
    assert.doesNotThrow(() => assertCampaignActiveForSend({ status: 'active' }));
  });
});
