const {
  verifyCalendlyWebhookSignature,
  handleCalendlyWebhook,
} = require('../services/calendlyWebhookService');
const calendlyAuthService = require('../services/calendlyAuthService');
const { errorResponse, successResponse } = require('../utils/response');

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function receiveWebhook(req, res) {
  const userId = req.params.userId ? String(req.params.userId).trim() : null;
  if (!userId || !UUID_RE.test(userId)) {
    return errorResponse(res, 400, 'Invalid user id in webhook URL.');
  }

  const signingKey = await calendlyAuthService.getWebhookSigningKeyForUser(userId);
  const legacyKey = process.env.CALENDLY_WEBHOOK_SIGNING_KEY || null;
  const keysToTry = [signingKey, legacyKey].filter(Boolean);

  if (keysToTry.length === 0) {
    return errorResponse(res, 503, 'Calendly webhook is not configured for this user.');
  }

  const signature = req.headers['calendly-webhook-signature'];
  const rawBody = req.body;

  const verified = keysToTry.some((key) =>
    verifyCalendlyWebhookSignature(rawBody, signature, key)
  );

  if (!verified) {
    return errorResponse(res, 401, 'Invalid Calendly webhook signature.');
  }

  let body;
  try {
    body = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody));
  } catch {
    return errorResponse(res, 400, 'Invalid JSON body.');
  }

  const result = await handleCalendlyWebhook(body, { platformUserId: userId });
  return successResponse(res, 200, 'Webhook processed.', result);
}

module.exports = { receiveWebhook };
