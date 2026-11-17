const { it } = require('node:test');
const assert = require('node:assert/strict');
const loadService = require('./helpers/loadService.cjs');
const logger = { info() {}, warn() {}, error() {} };
function scheduler(jobs) {
  const removed = [];
  const added = [];
  const service = loadService('src/jobs/leadPipelineJob.js', {
    '../queues/leadPipelineQueue': {
      LEAD_PIPELINE_REPEAT_JOB_ID: 'lead-pipeline-repeatable',
      async getRepeatableJobs() {
        return jobs;
      },
      async removeRepeatableByKey(key) {
        removed.push(key);
      },
      async add(...args) {
        added.push(args);
      },
    },
    '../utils/logger': logger,
  });
  return { service, removed, added };
}
it('waking the web process preserves the overdue lead-fetch job instead of deferring it', async () => {
  const stub = scheduler([
    {
      name: 'fill-leads-pool',
      key: 'existing',
      pattern: '0 */6 * * *',
      next: Date.now() - 86400000,
    },
  ]);
  await stub.service.ensureLeadPipelineRepeatable();
  await stub.service.ensureLeadPipelineRepeatable();
  assert.deepEqual(stub.removed, []);
  assert.deepEqual(stub.added, []);
});
it('lead schedule changes remove only obsolete owned schedules', async () => {
  const stub = scheduler([
    { name: 'fill-leads-pool', key: 'old', pattern: '* * * * *' },
    { name: 'other', key: 'unrelated' },
  ]);
  await stub.service.ensureLeadPipelineRepeatable();
  assert.deepEqual(stub.removed, ['old']);
  assert.equal(stub.added.length, 1);
  assert.equal(stub.added[0][2].repeat.pattern, stub.service.REPEAT_CRON);
});
it('extra duplicate schedules are removed without losing the current schedule', async () => {
  const stub = scheduler([
    { name: 'fill-leads-pool', key: 'keep', pattern: '0 */6 * * *' },
    { name: 'fill-leads-pool', key: 'old', pattern: '* * * * *' },
  ]);
  await stub.service.ensureLeadPipelineRepeatable();
  assert.deepEqual(stub.removed, ['old']);
  assert.equal(stub.added.length, 0);
});
async function withCronEnv(fn) {
  const saved = { key: process.env.APOLLO_API_KEY, targets: process.env.LEAD_PIPELINE_TARGETS };
  process.env.APOLLO_API_KEY = 'test';
  process.env.LEAD_PIPELINE_TARGETS = 'EQAIESPORTS:VENUE';
  try {
    await fn();
  } finally {
    for (const [key, value] of [
      ['APOLLO_API_KEY', saved.key],
      ['LEAD_PIPELINE_TARGETS', saved.targets],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
function cron(runLeadPipeline) {
  return loadService('src/services/leadPipelineCronService.js', {
    '../utils/logger': logger,
    './leadPipelineService': { runLeadPipeline },
  });
}
it('missing Apollo configuration fails the cron job visibly', async () =>
  withCronEnv(async () => {
    delete process.env.APOLLO_API_KEY;
    await assert.rejects(cron(async () => {}).runScheduledLeadPipeline(), {
      code: 'APOLLO_NOT_CONFIGURED',
    });
  }));
it('an all-category outage fails the BullMQ job rather than reporting successful completion', async () =>
  withCronEnv(async () => {
    await assert.rejects(
      cron(async () => {
        throw new Error('provider down');
      }).runScheduledLeadPipeline(),
      { code: 'LEAD_PIPELINE_ALL_TARGETS_FAILED' }
    );
  }));
it('a successful search with zero new leads remains a legitimate completed run', async () =>
  withCronEnv(async () => {
    const result = await cron(async () => ({
      found: 5,
      saved: 0,
      inserted: 0,
      updated: 0,
    })).runScheduledLeadPipeline();
    assert.equal(result.saved, 0);
    assert.equal(result.results[0].found, 5);
  }));
