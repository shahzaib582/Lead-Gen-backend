const supabase = require('../config/supabase');
const AppError = require('../utils/AppError');

function isDefiniteRejection(err) {
  const status = Number(err.response?.status);
  return status >= 400 && status < 500 && status !== 408;
}

async function saveDelivery(key, values) {
  const { error } = await supabase
    .from('outbound_deliveries')
    .update(values)
    .eq('delivery_key', key);
  if (error)
    throw new AppError(
      'Failed to persist email delivery. Reconciliation required.',
      503,
      'DELIVERY_UNCONFIRMED'
    );
}

async function deliverOnce({ key, userId, send }) {
  const { data: claim, error } = await supabase.rpc('claim_outbound_delivery', {
    p_key: key,
    p_user_id: userId,
  });
  if (error || !claim)
    throw new AppError('Unable to reserve email delivery.', 503, 'DELIVERY_UNAVAILABLE');
  if (!claim.claimed) {
    if (claim.reason === 'already_sent') {
      return { status: 'sent', result: claim.result, sentAt: claim.sentAt, recovered: true };
    }
    return { status: 'skipped', reason: claim.reason };
  }

  let result;
  try {
    result = await send();
  } catch (err) {
    // Disable automatic HTTP retries in Gmail: a timeout can follow an accepted send.
    const definite = isDefiniteRejection(err);
    await saveDelivery(key, {
      status: definite ? 'failed' : 'uncertain',
      error_message: String(err.message).slice(0, 500),
    });
    if (!definite)
      throw new AppError(
        'Email delivery could not be confirmed. Reconciliation required.',
        503,
        'DELIVERY_UNCONFIRMED'
      );
    throw err;
  }
  const sentAt = new Date().toISOString();
  await saveDelivery(key, { status: 'sent', result, attempted_at: sentAt, error_message: null });
  return { status: 'sent', result, sentAt };
}

module.exports = { deliverOnce, isDefiniteRejection };
