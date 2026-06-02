const billingService = require('../services/billingService');
const { successResponse } = require('../utils/response');

async function listPlans(req, res, next) {
  try {
    const plans = await billingService.listActivePlans();
    return successResponse(res, 200, undefined, { plans });
  } catch (err) {
    next(err);
  }
}

async function getSubscription(req, res, next) {
  try {
    const subscription = await billingService.getUserSubscription(req.user.id);
    return successResponse(res, 200, undefined, { subscription });
  } catch (err) {
    next(err);
  }
}

async function checkout(req, res, next) {
  try {
    const { planId } = req.body;
    const result = await billingService.createCheckoutSession(req.user.id, planId);
    return successResponse(res, 200, 'Checkout session created.', result);
  } catch (err) {
    next(err);
  }
}

async function portal(req, res, next) {
  try {
    const result = await billingService.createPortalSession(req.user.id);
    return successResponse(res, 200, 'Billing portal session created.', result);
  } catch (err) {
    next(err);
  }
}

async function upgrade(req, res, next) {
  try {
    const { planId } = req.body;
    const result = await billingService.upgradePlan(req.user.id, planId);
    return successResponse(res, 200, 'Plan upgrade initiated.', result);
  } catch (err) {
    next(err);
  }
}

async function downgrade(req, res, next) {
  try {
    const { planId } = req.body;
    const result = await billingService.downgradePlan(req.user.id, planId);
    return successResponse(res, 200, 'Plan downgrade initiated.', result);
  } catch (err) {
    next(err);
  }
}

async function cancel(req, res, next) {
  try {
    const result = await billingService.cancelSubscription(req.user.id);
    return successResponse(res, 200, 'Subscription will cancel at period end.', result);
  } catch (err) {
    next(err);
  }
}

async function reactivate(req, res, next) {
  try {
    const result = await billingService.reactivateSubscription(req.user.id);
    return successResponse(res, 200, 'Subscription reactivated.', result);
  } catch (err) {
    next(err);
  }
}

async function listPaymentMethods(req, res, next) {
  try {
    const result = await billingService.listPaymentMethods(req.user.id);
    return successResponse(res, 200, undefined, result);
  } catch (err) {
    next(err);
  }
}

async function setDefaultPaymentMethod(req, res, next) {
  try {
    const { paymentMethodId } = req.body;
    const result = await billingService.setDefaultPaymentMethod(req.user.id, paymentMethodId);
    return successResponse(res, 200, 'Default payment method updated.', result);
  } catch (err) {
    next(err);
  }
}

async function removePaymentMethod(req, res, next) {
  try {
    const { paymentMethodId } = req.params;
    const result = await billingService.detachPaymentMethod(req.user.id, paymentMethodId);
    return successResponse(res, 200, 'Payment method removed.', result);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listPlans,
  getSubscription,
  checkout,
  portal,
  upgrade,
  downgrade,
  cancel,
  reactivate,
  listPaymentMethods,
  setDefaultPaymentMethod,
  removePaymentMethod,
};
