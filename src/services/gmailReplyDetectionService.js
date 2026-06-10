const supabase = require('../config/supabase');
const googleAuthService = require('./googleAuthService');
const { safeThreadHasLeadReply } = require('./gmailThreadService');
const { maybeCreateThankYouDraft } = require('./thankYouDraftService');
const { parseLeadDataId } = require('../utils/leadDataId');
const logger = require('../utils/logger');

const REPLY_SCAN_SELECT =
  'id, campaign_id, lead_data_id, gmail_thread_id, gmail_message_id, gmail_subject, gmail_rfc_message_id, reply_received, thank_you_draft_gmail_id';

/**
 * Check Gmail threads for lead replies and set campaign_leads.reply_received.
 * @returns {Promise<{ scanned: number, marked: number, errors: number }>}
 */
async function syncReplyFlagsForUser(userId, { campaignId } = {}) {
  const summary = { scanned: 0, marked: 0, errors: 0 };

  let accessToken;
  try {
    accessToken = await googleAuthService.getValidGoogleAccessToken(userId);
  } catch (err) {
    logger.warn('[ReplyDetection] No Google token for user', { userId, error: err.message });
    return summary;
  }

  const { data: googleAcct } = await supabase
    .from('google_accounts')
    .select('email')
    .eq('user_id', userId)
    .maybeSingle();

  const userEmail = googleAcct?.email ? String(googleAcct.email).trim() : null;
  if (!userEmail) return summary;

  let leadQuery = supabase
    .from('campaign_leads')
    .select(REPLY_SCAN_SELECT)
    .eq('user_id', userId)
    .eq('status', 'sent')
    .eq('reply_received', false)
    .not('gmail_thread_id', 'is', null);

  if (campaignId) {
    leadQuery = leadQuery.eq('campaign_id', campaignId);
  }

  const { data: leads, error } = await leadQuery;

  if (error) {
    logger.error('[ReplyDetection] Failed to load leads', { userId, error: error.message });
    return summary;
  }

  for (const lead of leads || []) {
    summary.scanned += 1;

    const { data: leadRow, error: ldErr } = await supabase
      .from('leads_data')
      .select('email')
      .eq('id', parseLeadDataId(lead.lead_data_id))
      .maybeSingle();

    const leadEmail = leadRow?.email ? String(leadRow.email).trim() : null;
    if (ldErr || !leadEmail) continue;

    try {
      const hasReply = await safeThreadHasLeadReply({
        accessToken,
        threadId: lead.gmail_thread_id,
        leadEmail,
        userEmail,
        outboundGmailMessageId: lead.gmail_message_id,
      });

      if (!hasReply) continue;

      const { error: upErr } = await supabase
        .from('campaign_leads')
        .update({
          reply_received: true,
          reply_received_at: new Date().toISOString(),
        })
        .eq('id', lead.id)
        .eq('user_id', userId);

      if (upErr) {
        summary.errors += 1;
        logger.warn('[ReplyDetection] Failed to mark reply_received', {
          campaignLeadId: lead.id,
          error: upErr.message,
        });
      } else {
        summary.marked += 1;
        logger.info('[ReplyDetection] Lead replied — follow-ups will be skipped', {
          campaignLeadId: lead.id,
          leadEmail,
        });

        const { notifyReplyReceived } = require('./notificationService');
        void notifyReplyReceived(userId, {
          campaignId: lead.campaign_id,
          campaignLeadId: lead.id,
          leadEmail,
        });

        await maybeCreateThankYouDraft({
          userId,
          campaignLead: { ...lead, reply_received: true },
          accessToken,
          userEmail,
        });
      }
    } catch (err) {
      summary.errors += 1;
      logger.warn('[ReplyDetection] Scan failed for lead', {
        campaignLeadId: lead.id,
        error: err.message,
      });
    }
  }

  return summary;
}

/**
 * Sync replies for every user with sent leads awaiting reply detection.
 */
async function syncReplyFlagsBeforeFollowUps() {
  const { data: rows, error } = await supabase
    .from('campaign_leads')
    .select('user_id')
    .eq('status', 'sent')
    .eq('reply_received', false)
    .not('gmail_thread_id', 'is', null);

  if (error) {
    logger.error('[ReplyDetection] Failed to load leads pending reply scan', {
      error: error.message,
    });
    return { users: 0, scanned: 0, marked: 0, errors: 0 };
  }

  const userIds = [...new Set((rows || []).map((r) => r.user_id))];
  const totals = { users: userIds.length, scanned: 0, marked: 0, errors: 0 };

  for (const userId of userIds) {
    const s = await syncReplyFlagsForUser(userId);
    totals.scanned += s.scanned;
    totals.marked += s.marked;
    totals.errors += s.errors;
  }

  if (totals.marked > 0) {
    logger.info('[ReplyDetection] Sync complete', totals);
  }

  return totals;
}

function scheduleReplySyncForUser(userId, options = {}) {
  void syncReplyFlagsForUser(userId, options).catch((err) => {
    logger.warn('[ReplyDetection] Background sync failed', { userId, error: err.message });
  });
}

module.exports = {
  syncReplyFlagsForUser,
  syncReplyFlagsBeforeFollowUps,
  scheduleReplySyncForUser,
};
