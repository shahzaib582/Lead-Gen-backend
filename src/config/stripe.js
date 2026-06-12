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
  const first = String(raw).split(',')[0].trim() || 'http://localhost:8080';
  return first.replace(/\/$/, '');
}

/** Safe billing return URL on the app frontend (Stripe Customer Portal return_url). */
function buildBillingReturnUrl(returnPath = '/billing') {
  const base = getFrontendUrl();
  const path = String(returnPath || '/billing').trim();
  if (!path.startsWith('/') || path.startsWith('//')) {
    return `${base}/billing`;
  }
  return `${base}${path}`;
}

function getBillingPortalConfigurationId() {
  const id = process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID;
  return id && String(id).trim() ? String(id).trim() : null;
}

module.exports = {
  getStripe,
  requireStripe,
  isStripeConfigured,
  getFrontendUrl,
  buildBillingReturnUrl,
  getBillingPortalConfigurationId,
};
