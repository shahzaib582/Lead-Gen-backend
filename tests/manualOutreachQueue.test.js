const { it } = require('node:test');
const assert = require('node:assert/strict');
const loadService = require('./helpers/loadService.cjs');

it('repeated manual run requests share a durable job until it finishes', async () => {
  const jobs = new Map();
  let added = 0;
  const service = loadService('src/jobs/manualOutreachJob.js', {
    '../queues/campaignMailQueue': {
      async getJob(id) {
        return jobs.get(id);
      },
      async add(name, data, { jobId }) {
        assert.equal(name, 'manual-outreach');
        added++;
        jobs.set(jobId, {
          async getState() {
            return 'active';
          },
          async remove() {
            jobs.delete(jobId);
          },
        });
      },
    },
  });
  const first = await service.enqueueManualOutreach({ userId: 'u', campaignId: 'c' });
  const duplicate = await service.enqueueManualOutreach({ userId: 'u', campaignId: 'c' });
  assert.equal(added, 1);
  assert.equal(first.jobId, duplicate.jobId);
  assert.equal(duplicate.alreadyQueued, true);
});
