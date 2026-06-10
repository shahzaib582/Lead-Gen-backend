const supabase = require('../config/supabase');
const { normalizeTrackingToken } = require('../utils/emailOpenTracking');
const logger = require('../utils/logger');

/**
 * Record the first open for a campaign lead identified by tracking token.
 * @returns {Promise<{ recorded: boolean }>}
 */
async function recordEmailOpen(rawToken) {
  const token = normalizeTrackingToken(rawToken);
  if (!token) return { recorded: false };

  const { data: lead, error: findErr } = await supabase
    .from('campaign_leads')
    .select('id, email_opened')
    .eq('open_tracking_token', token)
    .maybeSingle();

  if (findErr) {
    logger.warn('[OpenTracking] Lookup failed', { error: findErr.message });
    return { recorded: false };
  }

  if (!lead || lead.email_opened === true) {
    return { recorded: false };
  }

  const openedAt = new Date().toISOString();
  const { error: upErr } = await supabase
    .from('campaign_leads')
    .update({
      email_opened: true,
      email_opened_at: openedAt,
    })
    .eq('id', lead.id)
    .eq('email_opened', false);

  if (upErr) {
    logger.warn('[OpenTracking] Failed to record open', { campaignLeadId: lead.id, error: upErr.message });
    return { recorded: false };
  }

  logger.info('[OpenTracking] Email opened', { campaignLeadId: lead.id });
  return { recorded: true };
}

module.exports = { recordEmailOpen };
