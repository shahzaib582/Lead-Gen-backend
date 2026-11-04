const { randomUUID } = require('crypto');
const AppError = require('../utils/AppError');
const supabase = require('../config/supabase');
const logger = require('../utils/logger');
const stripeCustomerService = require('./stripeCustomerService');

function unixToIso(unixSec) {
  if (!unixSec) return null;
  return new Date(unixSec * 1000).toISOString();
}

async function findPlanByStripePriceId(stripePriceId) {
  if (!stripePriceId) return null;
  const { data, error } = await supabase
    .from('plans')
    .select('*')
    .eq('stripe_price_id', stripePriceId)
    .maybeSingle();
  if (error) throw new AppError('Failed to load Stripe plan.', 503);
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
    throw new AppError('Unknown Stripe price. Configure its plan before retrying.', 503);
  }

  const status = stripeSub.status || 'active';

  const { error: subscriptionError } = await supabase.from('user_subscriptions').upsert(
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

  if (subscriptionError) throw new AppError('Failed to save subscription.', 503);
  const { error: userError } = await supabase
    .from('users')
    .update({ current_plan_id: plan.id })
    .eq('id', userId);
  if (userError) throw new AppError('Failed to save user plan.', 503);
}

async function revertUserToStarter(userId) {
  await stripeCustomerService.assignStarterSubscription(userId);
}

async function handleStripeEvent(event) {
  const token = randomUUID();
  const { data: claim, error } = await supabase.rpc('claim_stripe_webhook', {
    p_event: event,
    p_token: token,
  });
  if (error) throw new AppError('Failed to claim Stripe webhook.', 503);
  if (claim === 'processed') return { handled: true, duplicate: true };
  if (claim !== 'claimed')
    throw new AppError('Stripe webhook is being processed. Retry later.', 503);
  try {
    await processStripeEvent(event);
    const { data, error: saveError } = await supabase
      .from('stripe_webhook_events')
      .update({
        processed_at: new Date().toISOString(),
        processing_started_at: null,
        processing_token: null,
      })
      .eq('stripe_event_id', event.id)
      .eq('processing_token', token)
      .select('id');
    if (saveError || !data?.length) throw new AppError('Failed to finalize Stripe webhook.', 503);
    return { handled: true, duplicate: false };
  } catch (err) {
    await supabase
      .from('stripe_webhook_events')
      .update({
        processing_started_at: null,
        processing_token: null,
        error_message: String(err.message).slice(0, 500),
      })
      .eq('stripe_event_id', event.id)
      .eq('processing_token', token);
    throw err;
  }
}

async function processStripeEvent(event) {
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
        const { data: subRow, error: lookupError } = await supabase
          .from('user_subscriptions')
          .select('user_id')
          .eq('stripe_subscription_id', subscriptionId)
          .maybeSingle();

        if (lookupError) throw new AppError('Failed to load subscription.', 503);
        if (subRow?.user_id) {
          const { error: updateError } = await supabase
            .from('user_subscriptions')
            .update({ status: 'past_due' })
            .eq('user_id', subRow.user_id);
          if (updateError) throw new AppError('Failed to update subscription.', 503);
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
