const supabase = require('../config/supabase');
const { getStripe, isStripeConfigured } = require('../config/stripe');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const userService = require('./userService');

const STARTER_PLAN_ID = 'starter';

async function findPlanById(planId) {
  const { data, error } = await supabase.from('plans').select('*').eq('id', planId).maybeSingle();
  if (error) throw new AppError('Failed to load plan.', 500);
  return data;
}

async function assignStarterSubscription(userId) {
  const { data, error } = await supabase
    .from('user_subscriptions')
    .upsert(
      {
        user_id: userId,
        plan_id: STARTER_PLAN_ID,
        status: 'active',
        stripe_subscription_id: null,
        stripe_price_id: null,
        current_period_start: new Date().toISOString(),
        current_period_end: null,
        cancel_at_period_end: false,
        canceled_at: null,
      },
      { onConflict: 'user_id' }
    )
    .select()
    .single();

  if (error) {
    throw new AppError('Failed to assign starter subscription.', 500);
  }

  await supabase.from('users').update({ current_plan_id: STARTER_PLAN_ID }).eq('id', userId);

  return data;
}

async function createStripeCustomerForUser(userId, email) {
  const stripe = getStripe();
  if (!stripe) return null;

  const { data: user, error } = await supabase
    .from('users')
    .select('id, email, stripe_customer_id, deleted_at')
    .eq('id', userId)
    .maybeSingle();

  if (error || !user) throw new AppError('User not found.', 404);
  if (user.deleted_at) throw new AppError('Account is closed.', 403, 'ACCOUNT_CLOSED');
  if (user.stripe_customer_id) return user.stripe_customer_id;

  const customer = await stripe.customers.create({
    email: email || user.email,
    metadata: { userId: String(userId) },
  });

  const { error: updateErr } = await supabase
    .from('users')
    .update({ stripe_customer_id: customer.id })
    .eq('id', userId);

  if (updateErr) {
    logger.warn('[StripeCustomer] Failed to save stripe_customer_id', {
      userId,
      error: updateErr.message,
    });
  }

  return customer.id;
}

/**
 * On signup: Stripe customer + local starter plan. Non-throwing for callers.
 */
async function bootstrapUserBilling(userId, email) {
  try {
    if (isStripeConfigured()) {
      await createStripeCustomerForUser(userId, email);
    }
    await assignStarterSubscription(userId);
  } catch (err) {
    logger.warn('[BillingBootstrap] Failed', {
      userId,
      error: err.message,
    });
  }
}

async function ensureStripeCustomer(userId) {
  userService.assertUserActive(await userService.findUserById(userId));

  const user = await userService.findUserById(userId);
  if (!user) throw new AppError('User not found.', 404);

  if (user.stripe_customer_id) return user.stripe_customer_id;
  return createStripeCustomerForUser(userId, user.email);
}

module.exports = {
  STARTER_PLAN_ID,
  findPlanById,
  assignStarterSubscription,
  createStripeCustomerForUser,
  bootstrapUserBilling,
  ensureStripeCustomer,
};
