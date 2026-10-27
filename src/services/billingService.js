const supabase = require('../config/supabase');
const AppError = require('../utils/AppError');
const {
  requireStripe,
  buildBillingReturnUrl,
  getBillingPortalConfigurationId,
} = require('../config/stripe');
const {
  toPublicPlan,
  toPublicSubscription,
  toPublicPaymentMethod,
} = require('../utils/billingPublic');
const { isUpgrade, isDowngrade, isPaidPlan } = require('../utils/billingPlanOrder');
const stripeCustomerService = require('./stripeCustomerService');
const userService = require('./userService');

async function assertBillingUser(userId) {
  const user = await userService.findUserById(userId);
  if (!user) throw new AppError('User not found.', 404);
  userService.assertUserActive(user);
  return user;
}

async function getSubscriptionRow(userId) {
  const { data, error } = await supabase
    .from('user_subscriptions')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw new AppError('Failed to load subscription.', 500);
  return data;
}

async function listActivePlans() {
  const { data, error } = await supabase
    .from('plans')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (error) throw new AppError('Failed to load plans.', 500);
  return (data || []).map(toPublicPlan);
}

async function getUserSubscription(userId) {
  await assertBillingUser(userId);
  let sub = await getSubscriptionRow(userId);
  if (!sub) {
    sub = await stripeCustomerService.assignStarterSubscription(userId);
  }

  const plan = await stripeCustomerService.findPlanById(sub.plan_id);
  return toPublicSubscription(sub, plan);
}

async function createCheckoutSession(userId, planId) {
  await assertBillingUser(userId);
  const plan = await stripeCustomerService.findPlanById(planId);
  if (!plan || !plan.is_active) throw new AppError('Plan not found.', 404);
  if (!isPaidPlan(planId)) {
    throw new AppError('Starter plan is free and does not require checkout.', 400, 'PLAN_IS_FREE');
  }
  if (!plan.stripe_price_id) {
    throw new AppError(
      'This plan is not linked to Stripe yet. Set stripe_price_id in plans table.',
      503,
      'STRIPE_PRICE_NOT_CONFIGURED'
    );
  }

  const stripe = requireStripe();
  const customerId = await stripeCustomerService.ensureStripeCustomer(userId);

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
    success_url: `${buildBillingReturnUrl('/billing/success')}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: buildBillingReturnUrl('/billing/cancel'),
    metadata: {
      userId: String(userId),
      planId: String(planId),
    },
    subscription_data: {
      metadata: {
        userId: String(userId),
        planId: String(planId),
      },
    },
  });

  return { url: session.url, checkoutUrl: session.url, sessionId: session.id };
}

function mapStripePortalError(err) {
  const message = err?.message || 'Failed to create billing portal session.';
  if (/no configuration provided and default.*has been created/i.test(message)) {
    return new AppError(
      'Stripe Customer Portal is not configured. Enable it in Stripe Dashboard → Settings → Billing → Customer portal.',
      503,
      'STRIPE_PORTAL_NOT_CONFIGURED'
    );
  }
  if (/invalid.*return_url/i.test(message)) {
    return new AppError(
      'Billing portal return URL is invalid. Set FRONTEND_URL to your app origin (e.g. https://rapidai2x.com).',
      503,
      'STRIPE_PORTAL_RETURN_URL_INVALID'
    );
  }
  return new AppError(message, err?.statusCode || 502, err?.code || 'STRIPE_PORTAL_ERROR');
}

async function createPortalSession(userId, { returnPath } = {}) {
  await assertBillingUser(userId);
  const stripe = requireStripe();
  const customerId = await stripeCustomerService.ensureStripeCustomer(userId);
  const returnUrl = buildBillingReturnUrl(returnPath);

  const payload = {
    customer: customerId,
    return_url: returnUrl,
  };

  const configurationId = getBillingPortalConfigurationId();
  if (configurationId) {
    payload.configuration = configurationId;
  }

  let session;
  try {
    session = await stripe.billingPortal.sessions.create(payload);
  } catch (err) {
    throw mapStripePortalError(err);
  }

  return {
    url: session.url,
    portalUrl: session.url,
    returnUrl,
  };
}

async function getStripeSubscriptionForUser(userId) {
  const sub = await getSubscriptionRow(userId);
  if (!sub?.stripe_subscription_id) return null;
  const stripe = requireStripe();
  return stripe.subscriptions.retrieve(sub.stripe_subscription_id);
}

async function updatePaidSubscriptionPrice(userId, plan, { prorationBehavior }) {
  const stripe = requireStripe();
  const stripeSub = await getStripeSubscriptionForUser(userId);
  if (!stripeSub) {
    throw new AppError(
      'No active paid subscription. Use checkout to subscribe.',
      400,
      'NO_PAID_SUBSCRIPTION'
    );
  }

  const itemId = stripeSub.items?.data?.[0]?.id;
  if (!itemId) throw new AppError('Subscription has no billable item.', 500);

  const updated = await stripe.subscriptions.update(stripeSub.id, {
    items: [{ id: itemId, price: plan.stripe_price_id }],
    proration_behavior: prorationBehavior,
    cancel_at_period_end: false,
    metadata: {
      userId: String(userId),
      planId: String(plan.id),
    },
  });

  return updated;
}

async function upgradePlan(userId, planId) {
  await assertBillingUser(userId);
  const target = await stripeCustomerService.findPlanById(planId);
  if (!target || !target.is_active) throw new AppError('Plan not found.', 404);
  if (!isPaidPlan(planId)) {
    throw new AppError('Use downgrade to move to Starter.', 400);
  }
  if (!target.stripe_price_id) {
    throw new AppError('Plan Stripe price is not configured.', 503, 'STRIPE_PRICE_NOT_CONFIGURED');
  }

  const currentSub = await getSubscriptionRow(userId);
  const currentPlanId = currentSub?.plan_id || 'starter';

  if (!isUpgrade(currentPlanId, planId)) {
    throw new AppError('Target plan must be higher than your current plan.', 400, 'NOT_AN_UPGRADE');
  }

  if (!currentSub?.stripe_subscription_id) {
    return createCheckoutSession(userId, planId);
  }

  await updatePaidSubscriptionPrice(userId, target, { prorationBehavior: 'create_prorations' });

  const subscription = await getUserSubscription(userId);
  return { subscription, upgraded: true };
}

async function downgradePlan(userId, planId) {
  await assertBillingUser(userId);
  const target = await stripeCustomerService.findPlanById(planId);
  if (!target || !target.is_active) throw new AppError('Plan not found.', 404);

  const currentSub = await getSubscriptionRow(userId);
  const currentPlanId = currentSub?.plan_id || 'starter';

  if (!isDowngrade(currentPlanId, planId)) {
    throw new AppError('Target plan must be lower than your current plan.', 400, 'NOT_A_DOWNGRADE');
  }

  if (planId === 'starter') {
    return cancelSubscription(userId);
  }

  if (!target.stripe_price_id) {
    throw new AppError('Plan Stripe price is not configured.', 503, 'STRIPE_PRICE_NOT_CONFIGURED');
  }
  if (!currentSub?.stripe_subscription_id) {
    throw new AppError('No paid subscription to downgrade.', 400, 'NO_PAID_SUBSCRIPTION');
  }

  await updatePaidSubscriptionPrice(userId, target, { prorationBehavior: 'none' });

  return {
    subscription: await getUserSubscription(userId),
    downgraded: true,
    note: 'Downgrade applies at the start of the next billing period.',
  };
}

async function cancelSubscription(userId) {
  await assertBillingUser(userId);
  const sub = await getSubscriptionRow(userId);
  if (!sub?.stripe_subscription_id) {
    throw new AppError('No paid subscription to cancel.', 400, 'NO_PAID_SUBSCRIPTION');
  }

  const stripe = requireStripe();
  await stripe.subscriptions.update(sub.stripe_subscription_id, {
    cancel_at_period_end: true,
  });

  const { error } = await supabase
    .from('user_subscriptions')
    .update({ cancel_at_period_end: true })
    .eq('user_id', userId);

  if (error) throw new AppError('Failed to update subscription.', 500);

  return { subscription: await getUserSubscription(userId), cancelAtPeriodEnd: true };
}

async function reactivateSubscription(userId) {
  await assertBillingUser(userId);
  const sub = await getSubscriptionRow(userId);
  if (!sub?.stripe_subscription_id) {
    throw new AppError('No paid subscription to reactivate.', 400, 'NO_PAID_SUBSCRIPTION');
  }
  if (!sub.cancel_at_period_end) {
    throw new AppError('Subscription is not scheduled for cancellation.', 400);
  }

  const stripe = requireStripe();
  await stripe.subscriptions.update(sub.stripe_subscription_id, {
    cancel_at_period_end: false,
  });

  const { error } = await supabase
    .from('user_subscriptions')
    .update({ cancel_at_period_end: false, canceled_at: null })
    .eq('user_id', userId);

  if (error) throw new AppError('Failed to update subscription.', 500);

  return { subscription: await getUserSubscription(userId), reactivated: true };
}

async function listPaymentMethods(userId) {
  await assertBillingUser(userId);
  const stripe = requireStripe();
  const customerId = await stripeCustomerService.ensureStripeCustomer(userId);

  const customer = await stripe.customers.retrieve(customerId);
  const defaultPm =
    typeof customer.invoice_settings?.default_payment_method === 'string'
      ? customer.invoice_settings.default_payment_method
      : customer.invoice_settings?.default_payment_method?.id || null;

  const methods = await stripe.paymentMethods.list({
    customer: customerId,
    type: 'card',
  });

  return {
    paymentMethods: (methods.data || [])
      .map((pm) => toPublicPaymentMethod(pm, pm.id === defaultPm))
      .filter(Boolean),
  };
}

async function setDefaultPaymentMethod(userId, paymentMethodId) {
  await assertBillingUser(userId);
  const stripe = requireStripe();
  const customerId = await stripeCustomerService.ensureStripeCustomer(userId);

  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: paymentMethodId },
  });

  return listPaymentMethods(userId);
}

async function detachPaymentMethod(userId, paymentMethodId) {
  await assertBillingUser(userId);
  const stripe = requireStripe();
  const customerId = await stripeCustomerService.ensureStripeCustomer(userId);

  const sub = await getSubscriptionRow(userId);
  const isPaidActive =
    sub?.stripe_subscription_id && ['active', 'trialing', 'past_due'].includes(sub.status);

  const methods = await stripe.paymentMethods.list({ customer: customerId, type: 'card' });
  if (isPaidActive && methods.data.length <= 1) {
    throw new AppError(
      'Cannot remove the only payment method while a paid subscription is active.',
      400,
      'LAST_PAYMENT_METHOD'
    );
  }

  await stripe.paymentMethods.detach(paymentMethodId);
  return listPaymentMethods(userId);
}

module.exports = {
  listActivePlans,
  getUserSubscription,
  createCheckoutSession,
  createPortalSession,
  upgradePlan,
  downgradePlan,
  cancelSubscription,
  reactivateSubscription,
  listPaymentMethods,
  setDefaultPaymentMethod,
  detachPaymentMethod,
};
