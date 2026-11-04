const { it } = require('node:test');
const assert = require('node:assert/strict');
const loadService = require('./helpers/loadService.cjs');

it('Stripe processing retries failed writes and skips only processed events', async () => {
  let processed = false;
  let busy = false;
  let failSubscription = true;
  let subscriptionWrites = 0;
  let finalizations = 0;
  const service = loadService('src/services/stripeWebhookService.js', {
    '../config/supabase': {
      async rpc() {
        if (processed) return { data: 'processed' };
        if (busy) return { data: 'busy' };
        busy = true;
        return { data: 'claimed' };
      },
      from(table) {
        const query = {
          select() {
            return query;
          },
          eq() {
            return query;
          },
          async maybeSingle() {
            return { data: { id: 'pro' } };
          },
          async upsert() {
            subscriptionWrites++;
            return failSubscription ? { error: { message: 'DB down' } } : {};
          },
          update(values) {
            if (table === 'stripe_webhook_events') {
              busy = false;
              if (values.processed_at) {
                processed = true;
                finalizations++;
              }
            }
            return query;
          },
          then(resolve) {
            resolve({ data: [{ id: 'event-row' }] });
          },
        };
        return query;
      },
    },
    '../utils/logger': { warn() {}, error() {} },
    './stripeCustomerService': {},
  });
  const event = {
    id: 'evt_1',
    type: 'customer.subscription.updated',
    data: {
      object: {
        id: 'sub_1',
        status: 'active',
        metadata: { userId: 'user' },
        items: { data: [{ price: { id: 'price_pro' } }] },
      },
    },
  };
  await assert.rejects(service.handleStripeEvent(event), /Failed to save subscription/);
  assert.equal(processed, false);
  failSubscription = false;
  assert.equal((await service.handleStripeEvent(event)).duplicate, false);
  assert.equal((await service.handleStripeEvent(event)).duplicate, true);
  assert.equal(subscriptionWrites, 2);
  assert.equal(finalizations, 1);
});
