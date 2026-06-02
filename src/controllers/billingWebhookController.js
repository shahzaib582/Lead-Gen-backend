const { requireStripe } = require('../config/stripe');
const { handleStripeEvent } = require('../services/stripeWebhookService');
const { errorResponse, successResponse } = require('../utils/response');
const logger = require('../utils/logger');

async function handleWebhook(req, res) {
  const stripe = requireStripe();
  const signature = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    return errorResponse(res, 503, 'Stripe webhook secret is not configured.');
  }
  if (!signature) {
    return errorResponse(res, 400, 'Missing stripe-signature header.');
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
  } catch (err) {
    logger.warn('[StripeWebhook] signature verification failed', { error: err.message });
    return errorResponse(res, 400, `Webhook Error: ${err.message}`);
  }

  try {
    const result = await handleStripeEvent(event);
    return successResponse(res, 200, 'Webhook received.', result);
  } catch (err) {
    logger.error('[StripeWebhook] handler failed', { type: event.type, error: err.message });
    return errorResponse(res, 500, 'Webhook handler failed.');
  }
}

module.exports = { handleWebhook };
