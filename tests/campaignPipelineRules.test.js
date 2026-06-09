const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { shouldAutoEnqueuePipeline } = require('../src/services/campaignPipelineRules');

describe('campaignPipelineRules', () => {
  it('shouldAutoEnqueuePipeline is true only for active auto campaigns', () => {
    assert.equal(shouldAutoEnqueuePipeline({ status: 'active', run_mode: 'auto' }), true);
    assert.equal(shouldAutoEnqueuePipeline({ status: 'active', run_mode: 'manual' }), false);
    assert.equal(shouldAutoEnqueuePipeline({ status: 'paused', run_mode: 'auto' }), false);
    assert.equal(shouldAutoEnqueuePipeline(null), false);
  });
});
