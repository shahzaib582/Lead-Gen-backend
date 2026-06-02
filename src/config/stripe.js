require('dotenv').config();

let stripeClient = null;

function isStripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY && String(process.env.STRIPE_SECRET_KEY).trim());
}

function getStripe() {
  if (!isStripeConfigured()) {
    return null;
  }
  if (!stripeClient) {
    // eslint-disable-next-line global-require
    const Stripe = require('stripe');
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return stripeClient;
}

function requireStripe() {
  const stripe = getStripe();
  if (!stripe) {
    const AppError = require('../utils/AppError');
    throw new AppError('Stripe is not configured on the server.', 503, 'STRIPE_NOT_CONFIGURED');
  }
  return stripe;
}

function getFrontendUrl() {
  const raw = process.env.FRONTEND_URL || process.env.CORS_ORIGIN || 'http://localhost:8080';
  return String(raw).split(',')[0].trim() || 'http://localhost:8080';
}

module.exports = {
  getStripe,
  requireStripe,
  isStripeConfigured,
  getFrontendUrl,
};
