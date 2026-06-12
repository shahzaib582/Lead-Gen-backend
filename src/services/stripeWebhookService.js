const supabase = require('../config/supabase');
const logger = require('../utils/logger');
const stripeCustomerService = require('./stripeCustomerService');

function unixToIso(unixSec) {
  if (!unixSec) return null;
  return new Date(unixSec * 1000).toISOString();
}

async function findPlanByStripePriceId(stripePriceId) {
  if (!stripePriceId) return null;
  const { data } = await supabase
    .from('plans')
    .select('*')
    .eq('stripe_price_id', stripePriceId)
    .maybeSingle();
  return data;
}

async function syncSubscriptionFromStripe(stripeSub, fallbackPlanId = null) {
  const userId = stripeSub.metadata?.userId;
  if (!userId) {
    logger.warn('[StripeWebhook] subscription missing userId metadata', { id: stripeSub.id });
    return;
  }

  const priceId = stripeSub.items?.data?.[0]?.price?.id || stripeSub.plan?.id || null;
  let plan = await findPlanByStripePriceId(priceId);
  if (!plan && fallbackPlanId) {
    plan = await stripeCustomerService.findPlanById(fallbackPlanId);
  }
  if (!plan) {
    logger.warn('[StripeWebhook] unknown stripe price', { priceId, subscriptionId: stripeSub.id });
    return;
  }

  const status = stripeSub.status || 'active';

  await supabase.from('user_subscriptions').upsert(
    {
      user_id: userId,
      plan_id: plan.id,
      status,
      stripe_subscription_id: stripeSub.id,
      stripe_price_id: priceId,
      current_period_start: unixToIso(stripeSub.current_period_start),
      current_period_end: unixToIso(stripeSub.current_period_end),
      cancel_at_period_end: stripeSub.cancel_at_period_end === true,
      canceled_at: stripeSub.canceled_at ? unixToIso(stripeSub.canceled_at) : null,
    },
    { onConflict: 'user_id' }
  );

  await supabase.from('users').update({ current_plan_id: plan.id }).eq('id', userId);
}

async function revertUserToStarter(userId) {
  await stripeCustomerService.assignStarterSubscription(userId);
}

async function recordWebhookEvent(event) {
  const { error } = await supabase.from('stripe_webhook_events').insert({
    stripe_event_id: event.id,
    type: event.type,
    payload: event,
  });

  if (error?.code === '23505') {
    return { duplicate: true };
  }
  if (error) {
    logger.error('[StripeWebhook] failed to record event', { error: error.message });
  }
  return { duplicate: false };
}

async function handleStripeEvent(event) {
  const recorded = await recordWebhookEvent(event);
  if (recorded.duplicate) {
    return { handled: true, duplicate: true };
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const userId = session.metadata?.userId;
      const planId = session.metadata?.planId;
      const subscriptionId =
        typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;

      if (subscriptionId && userId) {
        const stripe = require('../config/stripe').getStripe();
        if (stripe) {
          const stripeSub = await stripe.subscriptions.retrieve(subscriptionId);
          await syncSubscriptionFromStripe(stripeSub, planId);
        }
      }
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      await syncSubscriptionFromStripe(event.data.object);
      break;
    }
    case 'customer.subscription.deleted': {
      const stripeSub = event.data.object;
      const userId = stripeSub.metadata?.userId;
      if (userId) {
        await revertUserToStarter(userId);
      }
      break;
    }
    case 'invoice.payment_succeeded': {
      const invoice = event.data.object;
      const subscriptionId =
        typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
      if (subscriptionId) {
        const stripe = require('../config/stripe').getStripe();
        if (stripe) {
          const stripeSub = await stripe.subscriptions.retrieve(subscriptionId);
          await syncSubscriptionFromStripe(stripeSub);
        }
      }
      break;
    }
    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const subscriptionId =
        typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
      if (subscriptionId) {
        const { data: subRow } = await supabase
          .from('user_subscriptions')
          .select('user_id')
          .eq('stripe_subscription_id', subscriptionId)
          .maybeSingle();

        if (subRow?.user_id) {
          await supabase
            .from('user_subscriptions')
            .update({ status: 'past_due' })
            .eq('user_id', subRow.user_id);
        }
      }
      break;
    }
    default:
      break;
  }

  return { handled: true, duplicate: false };
}

module.exports = {
  handleStripeEvent,
  syncSubscriptionFromStripe,
  revertUserToStarter,
  findPlanByStripePriceId,
};
