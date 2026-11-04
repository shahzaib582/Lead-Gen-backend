const { it } = require('node:test');
const assert = require('node:assert/strict');
const loadService = require('./helpers/loadService.cjs');

function loadWorker(outcome, manualResult) {
  let processJob;
  const events = [];
  const queued = [];
  class DelayedError extends Error {}
  const stubs = {
    bullmq: {
      Worker: class {
        constructor(name, fn) {
          processJob = fn;
        }
        on() {}
      },
      DelayedError,
    },
    '../queues/connection': {},
    '../config/supabase': {
      from(table) {
        const query = {
          select() {
            return query;
          },
          eq() {
            return query;
          },
          async single() {
            return {
              data:
                table === 'campaigns'
                  ? { id: 'c', status: 'active' }
                  : { id: 'l', status: 'template_generated' },
            };
          },
        };
        return query;
      },
    },
    '../utils/logger': { info() {}, warn() {}, error() {} },
    '../services/googleAuthService': {
      async getValidGoogleAccessToken() {
        return 'access';
      },
    },
    '../services/campaignMailerService': {
      async sendCampaignEmails() {
        return outcome;
      },
    },
    '../jobs/campaignMailJob': {
      async enqueueCampaignMailJob(data, options) {
        queued.push({ data, options });
      },
    },
    '../services/campaignEventsPublisher': {
      async publishCampaignEvent(id, event) {
        events.push(event);
      },
      async getCampaignProgressSnapshot() {
        return {};
      },
    },
    '../services/campaignManualRunService': {
      async runManualCampaignOutreach() {
        return manualResult;
      },
    },
  };
  loadService('src/workers/campaignMailWorker.js', stubs);
  return { processJob, events, queued, DelayedError };
}

it('a failed send summary triggers worker retry and never publishes mail_sent', async () => {
  const worker = loadWorker({
    failed: 1,
    results: [{ status: 'failed', error: 'Gmail rejected request', fatalCode: 'PROVIDER' }],
  });
  await assert.rejects(
    worker.processJob({
      name: 'send-campaign-mail',
      attemptsMade: 0,
      data: { userId: 'u', campaignId: 'c', campaignLeadId: 'l' },
    }),
    /Gmail rejected/
  );
  assert.equal(
    worker.events.some((event) => event.type === 'mail_sent'),
    false
  );
});

it('an automatic send at quota schedules tomorrow instead of exhausting retries', async () => {
  const worker = loadWorker({ sent: 0, failed: 0, dailyLimitReached: true });
  const result = await worker.processJob({
    name: 'send-campaign-mail',
    attemptsMade: 0,
    data: { userId: 'u', campaignId: 'c', campaignLeadId: 'l' },
  });
  assert.equal(result.deferred, true);
  assert.equal(worker.queued.length, 1);
  assert.equal(worker.queued[0].data.campaignLeadId, 'l');
  assert.ok(worker.queued[0].options.delay > 0);
  assert.equal(
    worker.events.some((event) => event.type === 'mail_sent'),
    false
  );
});

it('a manual run at quota moves its durable job to the next UTC day', async () => {
  const worker = loadWorker(null, { dailyLimitReached: true });
  let delayed;
  await assert.rejects(
    worker.processJob({
      name: 'manual-outreach',
      data: { userId: 'u', campaignId: 'c' },
      token: 'worker-lock',
      async moveToDelayed(at, token) {
        delayed = { at, token };
      },
    }),
    worker.DelayedError
  );
  assert.equal(delayed.token, 'worker-lock');
  assert.ok(delayed.at > Date.now());
});
