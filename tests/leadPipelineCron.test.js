const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { listPipelineTargets } = require('../src/services/leadPipelineCronService');

describe('lead pipeline cron', () => {
  it('lists every entity category by default', () => {
    const previous = process.env.LEAD_PIPELINE_TARGETS;
    delete process.env.LEAD_PIPELINE_TARGETS;
    const targets = listPipelineTargets();
    if (previous === undefined) delete process.env.LEAD_PIPELINE_TARGETS;
    else process.env.LEAD_PIPELINE_TARGETS = previous;
    assert.ok(targets.length >= 8);
    assert.ok(targets.some((t) => t.entity === 'EQAIESPORTS' && t.category === 'VENUE'));
  });
});
