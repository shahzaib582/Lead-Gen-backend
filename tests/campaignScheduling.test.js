const { it } = require('node:test');
const assert = require('node:assert/strict');
const loadService = require('./helpers/loadService.cjs');

function dbFor(tables) {
  return {
    from(table) {
      const query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        order() {
          return query;
        },
        async single() {
          return { data: tables[table][0] };
        },
        async maybeSingle() {
          return { data: tables[table][0] };
        },
        async range(start, end) {
          return { data: tables[table].slice(start, end + 1) };
        },
        update() {
          tables.updated = true;
          return query;
        },
        then(resolve) {
          resolve({});
        },
      };
      return query;
    },
  };
}

it('queued mail in campaign A does not prevent campaign B from starting', async () => {
  let enqueued;
  const service = loadService('src/services/campaignMailKickoffService.js', {
    '../config/supabase': dbFor({
      campaigns: [{ status: 'active', run_mode: 'auto' }],
      campaign_leads: [{ status: 'template_generated', mail_template: 'Hello' }],
    }),
    '../queues/campaignMailQueue': {
      async getJobs() {
        return [{ data: { campaignId: 'A' } }];
      },
    },
    '../queues/connection': {
      async set() {
        return 'OK';
      },
      async eval() {
        return 1;
      },
    },
    '../jobs/campaignMailJob': {
      async enqueueCampaignMailJob(data) {
        enqueued = data;
      },
    },
    '../utils/logger': { info() {}, warn() {} },
  });
  assert.equal(
    (
      await service.maybeKickoffCampaignMailChain({
        userId: 'u',
        campaignId: 'B',
        campaignLeadId: 'b',
      })
    ).started,
    true
  );
  assert.equal(enqueued.campaignId, 'B');
});

it('an auto campaign stays active until every outstanding follow-up has been sent', async () => {
  const tables = {
    campaigns: [{ status: 'active', run_mode: 'auto' }],
    campaign_leads: [{ id: 'lead', status: 'sent', reply_received: false }],
    campaign_follow_ups: [{ id: 'step', body_template: 'Hello again' }],
    campaign_lead_follow_ups: [],
  };
  const service = loadService('src/services/campaignCompletionService.js', {
    '../config/supabase': dbFor(tables),
  });
  assert.equal(await service.maybeCompleteCampaign('u', 'campaign'), false);
  assert.equal(tables.updated, undefined);
  tables.campaign_lead_follow_ups.push({ id: 'delivery', follow_up_id: 'step', status: 'sent' });
  assert.equal(await service.maybeCompleteCampaign('u', 'campaign'), true);
  assert.equal(tables.updated, true);
});
