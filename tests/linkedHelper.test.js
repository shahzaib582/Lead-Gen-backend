const { it } = require('node:test');
const assert = require('node:assert/strict');
const client = require('../src/services/linkedHelperClient');
const loadService = require('./helpers/loadService.cjs');

it('Linked Helper rejects unsafe webhook destinations and profile URLs', () => {
  for (const url of [
    'http://linkedhelper.com/a',
    'https://localhost/a',
    'https://linkedhelper.com.evil.test/a',
    'https://user@linkedhelper.com/a',
    'https://linkedhelper.com:8443/a',
  ]) {
    assert.throws(() => client.validateWebhook(url));
  }
  for (const url of [
    'https://linkedin.com.evil.test/in/person',
    'https://linkedin.com/company/test',
    'http://linkedin.com/in/person',
  ]) {
    assert.throws(() => client.profileUrl(url));
  }
  assert.equal(
    client.profileUrl('https://linkedin.com/in/person/?tracking=1'),
    'https://www.linkedin.com/in/person/'
  );
});
it('Linked Helper encrypts credentials and detects tampering', () => {
  const before = process.env.LINKED_HELPER_ENCRYPTION_KEY;
  process.env.LINKED_HELPER_ENCRYPTION_KEY = 'ab'.repeat(32);
  try {
    const ciphertext = client.encrypt('secret-webhook');
    assert.equal(ciphertext.includes('secret-webhook'), false);
    assert.equal(client.decrypt(ciphertext), 'secret-webhook');
    const parts = ciphertext.split('.');
    parts[2] = Buffer.from('tampered').toString('base64');
    assert.throws(() => client.decrypt(parts.join('.')));
  } finally {
    if (before === undefined) delete process.env.LINKED_HELPER_ENCRYPTION_KEY;
    else process.env.LINKED_HELPER_ENCRYPTION_KEY = before;
  }
});
it('Linked Helper sends documented payload and treats acceptance separately from delivery', async () => {
  const result = await client.enroll(
    'https://hooks.linkedhelper.com/test',
    'https://www.linkedin.com/in/test/',
    'Hello',
    async (url, options) => {
      assert.equal(options.redirect, 'error');
      assert.deepEqual(JSON.parse(options.body), {
        payload: {
          people: [
            {
              externalId: 'https://www.linkedin.com/in/test/',
              customFields: [
                { key: 'cs_source', value: 'lead-gen' },
                { key: 'cs_message', value: 'Hello' },
              ],
            },
          ],
        },
      });
      return { ok: true, status: 202 };
    }
  );
  assert.deepEqual(result, { status: 'accepted', http_status: 202 });
});
it('Linked Helper never retries network errors or server failures', async () => {
  let calls = 0;
  const result = await client.enroll(
    'https://hooks.linkedhelper.com/test',
    'profile',
    null,
    async () => {
      calls++;
      throw new Error('private-url');
    }
  );
  assert.equal(calls, 1);
  assert.deepEqual(result, { status: 'uncertain', http_status: null });
  for (const [status, expected] of [
    [400, 'rejected'],
    [429, 'rejected'],
    [408, 'uncertain'],
    [500, 'uncertain'],
  ]) {
    const outcome = await client.enroll(
      'https://hooks.linkedhelper.com/test',
      'profile',
      null,
      async () => ({ ok: false, status })
    );
    assert.equal(outcome.status, expected);
  }
});
function serviceStub({
  duplicate = false,
  ownerMissing = false,
  updateFails = false,
  mixed = false,
  reclaimable = false,
} = {}) {
  let retryAvailable = reclaimable;
  let sends = 0;
  let claims = 0;
  const database = {
    from(table) {
      let operation = 'read';
      const filters = {};
      const q = {
        select() {
          return q;
        },
        eq(name, value) {
          filters[name] = value;
          return q;
        },
        in() {
          return q;
        },
        insert() {
          operation = 'insert';
          return q;
        },
        update(fields) {
          operation = fields.status === 'submitting' ? 'retry' : 'update';
          return q;
        },
        single() {
          return q;
        },
        maybeSingle() {
          return q;
        },
        then(resolve, reject) {
          let value;
          if (table === 'campaigns') value = { data: ownerMissing ? null : { id: 'c' } };
          if (table === 'linked_helper_campaigns')
            value = { data: { webhook_encrypted: 'encrypted' } };
          if (table === 'campaign_leads')
            value = {
              data: [
                { id: 'lead', lead_data_id: '42' },
                ...(mixed ? [{ id: 'bad', lead_data_id: '43' }] : []),
              ],
            };
          if (table === 'leads_data')
            value = { data: [{ id: '42', linkedin: 'https://linkedin.com/in/test/' }] };
          if (table === 'linked_helper_enrollments' && operation === 'insert') {
            claims++;
            value = duplicate ? { error: { code: '23505' } } : { data: { id: 'claim' } };
          }
          if (table === 'linked_helper_enrollments' && operation === 'retry') {
            assert.equal(filters.status, 'rejected');
            assert.equal(filters.user_id, 'u');
            assert.equal(filters.campaign_id, 'c');
            value = { data: retryAvailable ? { id: 'retry-claim' } : null };
            retryAvailable = false;
          }
          if (table === 'linked_helper_enrollments' && operation === 'update')
            value = updateFails ? { error: { code: 'storage' } } : {};
          return Promise.resolve(value).then(resolve, reject);
        },
      };
      return q;
    },
  };
  const service = loadService('src/services/linkedHelperService.js', {
    '../config/supabase': database,
    './linkedHelperClient': {
      ...client,
      decrypt: () => 'https://hooks.linkedhelper.com/test',
      enroll: async () => {
        sends++;
        return { status: 'accepted', http_status: 200 };
      },
    },
  });
  return { service, sends: () => sends, claims: () => claims };
}
it('Linked Helper ownership denial prevents claims and external requests', async () => {
  const stub = serviceStub({ ownerMissing: true });
  await assert.rejects(
    stub.service.enrollLeads('u', 'c', [{ campaign_lead_id: 'lead' }]),
    /not found/
  );
  assert.equal(stub.claims(), 0);
  assert.equal(stub.sends(), 0);
});
it('Linked Helper durable duplicate claim prevents a second provider call', async () => {
  const stub = serviceStub({ duplicate: true });
  const result = await stub.service.enrollLeads('u', 'c', [{ campaign_lead_id: 'lead' }]);
  assert.equal(result.results[0].status, 'already_submitted');
  assert.equal(stub.sends(), 0);
});
it('Linked Helper validates all requested lead ownership before contacting provider', async () => {
  const stub = serviceStub();
  await assert.rejects(
    stub.service.enrollLeads('u', 'c', [{ campaign_lead_id: 'foreign' }]),
    /not found/
  );
  assert.equal(stub.claims(), 0);
  assert.equal(stub.sends(), 0);
});
it('Linked Helper keeps a durable claim when status persistence fails after provider acceptance', async () => {
  const stub = serviceStub({ updateFails: true });
  await assert.rejects(
    stub.service.enrollLeads('u', 'c', [{ campaign_lead_id: 'lead' }]),
    /storage/
  );
  assert.equal(stub.claims(), 1);
  assert.equal(stub.sends(), 1);
});
it('Linked Helper successful enrollment returns enrollment status without modifying email state', async () => {
  const stub = serviceStub();
  const result = await stub.service.enrollLeads('u', 'c', [
    { campaign_lead_id: 'lead', message: 'Hello' },
  ]);
  assert.deepEqual(result, {
    results: [{ campaign_lead_id: 'lead', status: 'accepted', http_status: 200 }],
  });
  assert.equal(stub.claims(), 1);
  assert.equal(stub.sends(), 1);
});
it('Linked Helper rejects a batch with unknown leads before any durable claims', async () => {
  const stub = serviceStub();
  await assert.rejects(
    stub.service.enrollLeads('u', 'c', [
      { campaign_lead_id: 'lead' },
      { campaign_lead_id: 'foreign' },
    ]),
    /not found/
  );
  assert.equal(stub.claims(), 0);
  assert.equal(stub.sends(), 0);
});
it('Linked Helper invalid profile does not block valid leads in the same batch', async () => {
  const stub = serviceStub({ mixed: true });
  const response = await stub.service.enrollLeads('u', 'c', [
    { campaign_lead_id: 'bad' },
    { campaign_lead_id: 'lead' },
  ]);
  assert.equal(response.results[0].status, 'invalid');
  assert.equal(response.results[1].status, 'accepted');
  assert.equal(stub.claims(), 1);
  assert.equal(stub.sends(), 1);
});
it('Linked Helper explicit rejected retry atomically takes the rejected claim only once', async () => {
  const stub = serviceStub({ duplicate: true, reclaimable: true });
  const input = [{ campaign_lead_id: 'lead', retry_rejected: true }];
  const first = await stub.service.enrollLeads('u', 'c', input);
  const second = await stub.service.enrollLeads('u', 'c', input);
  assert.equal(first.results[0].status, 'accepted');
  assert.equal(second.results[0].status, 'already_submitted');
  assert.equal(stub.sends(), 1);
});
it('Linked Helper explicit retry cannot take accepted or uncertain claims', async () => {
  const stub = serviceStub({ duplicate: true });
  const response = await stub.service.enrollLeads('u', 'c', [
    { campaign_lead_id: 'lead', retry_rejected: true },
  ]);
  assert.equal(response.results[0].status, 'already_submitted');
  assert.equal(stub.sends(), 0);
});
it('Linked Helper rejection is never retried without an explicit flag', async () => {
  const stub = serviceStub({ duplicate: true, reclaimable: true });
  const response = await stub.service.enrollLeads('u', 'c', [{ campaign_lead_id: 'lead' }]);
  assert.equal(response.results[0].status, 'already_submitted');
  assert.equal(stub.sends(), 0);
});
it('Linked Helper Settings summary counts only the authenticated user configuration and stays unverified', async () => {
  const service = loadService('src/services/linkedHelperService.js', {
    '../config/supabase': {
      from(table) {
        assert.equal(table, 'linked_helper_campaigns');
        return {
          select(columns, options) {
            assert.equal(columns, 'campaign_id');
            assert.deepEqual(options, { count: 'exact', head: true });
            return {
              eq(field, value) {
                assert.equal(field, 'user_id');
                assert.equal(value, 'owner');
                return Promise.resolve({ count: 2 });
              },
            };
          },
        };
      },
    },
  });
  assert.deepEqual(await service.connectionSummary('owner'), {
    configured_campaigns: 2,
    workflow_status: 'unverified',
  });
});
it('Linked Helper never submits the same profile twice within one explicit retry batch', async () => {
  const stub = serviceStub();
  const input = { campaign_lead_id: 'lead', retry_rejected: true };
  const response = await stub.service.enrollLeads('u', 'c', [input, input]);
  assert.equal(stub.sends(), 1);
  assert.equal(response.results[1].status, 'already_submitted');
});
