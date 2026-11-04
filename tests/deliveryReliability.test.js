const { it } = require('node:test');
const assert = require('node:assert/strict');
const loadService = require('./helpers/loadService.cjs');

function deliveryService() {
  const ledger = new Map();
  let failSave = false;
  const db = {
    async rpc(name, { p_key: key }) {
      const row = ledger.get(key);
      if (row?.status === 'sent')
        return {
          data: {
            claimed: false,
            reason: 'already_sent',
            result: row.result,
            sentAt: row.attempted_at,
          },
        };
      if (row && row.status !== 'failed')
        return { data: { claimed: false, reason: 'delivery_unconfirmed' } };
      ledger.set(key, { status: 'sending' });
      return { data: { claimed: true } };
    },
    from() {
      return {
        update(values) {
          return {
            async eq(field, key) {
              if (failSave) return { error: { message: 'database unavailable' } };
              Object.assign(ledger.get(key), values);
              return {};
            },
          };
        },
      };
    },
  };
  return {
    ...loadService('src/services/outboundDeliveryService.js', { '../config/supabase': db }),
    ledger,
    failSave() {
      failSave = true;
    },
  };
}

it('concurrent requests call Gmail once and recover the saved result without resending', async () => {
  const service = deliveryService();
  let sends = 0;
  const params = {
    key: 'initial-a',
    userId: 'u',
    send: async () => {
      sends++;
      await new Promise((r) => setTimeout(r, 5));
      return { messageId: 'gmail-1' };
    },
  };
  const results = await Promise.all([service.deliverOnce(params), service.deliverOnce(params)]);
  assert.equal(sends, 1);
  assert.equal(results.filter((r) => r.status === 'sent').length, 1);
  const retry = await service.deliverOnce(params);
  assert.equal(retry.recovered, true);
  assert.equal(retry.result.messageId, 'gmail-1');
  assert.equal(sends, 1);
});

it('a Gmail timeout is quarantined and cannot be automatically resent', async () => {
  const service = deliveryService();
  let sends = 0;
  const params = {
    key: 'followup-a',
    userId: 'u',
    send: async () => {
      sends++;
      throw new Error('timeout');
    },
  };
  await assert.rejects(service.deliverOnce(params), { code: 'DELIVERY_UNCONFIRMED' });
  assert.equal(service.ledger.get(params.key).status, 'uncertain');
  assert.equal((await service.deliverOnce(params)).reason, 'delivery_unconfirmed');
  assert.equal(sends, 1);
});

it('a failed persistence after Gmail accepts a message cannot cause a second send', async () => {
  const service = deliveryService();
  service.failSave();
  let sends = 0;
  const params = {
    key: 'initial-b',
    userId: 'u',
    send: async () => {
      sends++;
      return { messageId: 'gmail-2' };
    },
  };
  await assert.rejects(service.deliverOnce(params), { code: 'DELIVERY_UNCONFIRMED' });
  assert.equal((await service.deliverOnce(params)).reason, 'delivery_unconfirmed');
  assert.equal(sends, 1);
});

it('an explicit provider rejection can be retried safely', async () => {
  const service = deliveryService();
  const params = {
    key: 'initial-c',
    userId: 'u',
    send: async () => {
      throw Object.assign(new Error('rate limit'), { response: { status: 429 } });
    },
  };
  await assert.rejects(service.deliverOnce(params), /rate limit/);
  assert.equal(service.ledger.get(params.key).status, 'failed');
  const retry = await service.deliverOnce({
    ...params,
    send: async () => ({ messageId: 'gmail-3' }),
  });
  assert.equal(retry.status, 'sent');
});
