const { it } = require('node:test');
const assert = require('node:assert/strict');
const loadService = require('./helpers/loadService.cjs');

it('manual job status checks campaign ownership before reading the queue', async () => {
  let queried = false;
  const service = loadService('src/controllers/campaignRunStatusController.js', {
    '../services/campaignService': {
      async getCampaignById() {
        throw new Error('Campaign not found');
      },
    },
    '../queues/campaignMailQueue': {
      async getJob() {
        queried = true;
      },
    },
  });
  let error;
  await service.getRunStatus(
    { user: { id: 'other-user' }, params: { id: 'private' } },
    {},
    (err) => {
      error = err;
    }
  );
  assert.match(error.message, /not found/);
  assert.equal(queried, false);
});

it('manual job status returns bounded summary fields without exposing job internals', async () => {
  let response;
  const service = loadService('src/controllers/campaignRunStatusController.js', {
    '../services/campaignService': { async getCampaignById() {} },
    '../queues/campaignMailQueue': {
      async getJob() {
        return {
          id: 'manual-c',
          data: { userId: 'u' },
          attemptsMade: 1,
          async getState() {
            return 'completed';
          },
          returnvalue: {
            sent: 4,
            sendFailed: 1,
            sendSkipped: 2,
            results: ['private lead details'],
          },
        };
      },
    },
    '../utils/response': {
      successResponse(res, status, message, data) {
        response = data;
      },
    },
  });
  await service.getRunStatus({ user: { id: 'u' }, params: { id: 'c' } }, {}, (err) => {
    throw err;
  });
  assert.deepEqual(response.job.result, { sent: 4, failed: 1, skipped: 2 });
  assert.equal(response.job.state, 'completed');
  assert.equal(JSON.stringify(response).includes('private lead'), false);
});
