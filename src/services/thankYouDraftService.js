const supabase = require('../config/supabase');
const googleAuthService = require('./googleAuthService');
const { createGmailDraft } = require('./emailService');
const {
  safeThreadHasUserReplyAfterLead,
  safeGetLatestLeadReplyInThread,
} = require('./gmailThreadService');
const { resolveCampaignSenderForUser } = require('../utils/resolveCampaignSender');
const { applyTemplatePlaceholders } = require('../utils/templatePlaceholders');
const { buildReplySubject, normalizeMessageId } = require('../utils/gmailThread');
const { parseLeadDataId } = require('../utils/leadDataId');
const logger = require('../utils/logger');

const GMAIL_COMPOSE_SCOPE = 'https://www.googleapis.com/auth/gmail.compose';
const GMAIL_MODIFY_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';

const DEFAULT_THANK_YOU_BODY = `Hi {{firstName}},

Thank you for getting back to me — I really appreciate your reply.

Best regards,
{{senderName}}`;

function hasGmailComposeScope(scopes) {
  const list = Array.isArray(scopes) ? scopes : [];
  return list.includes(GMAIL_COMPOSE_SCOPE) || list.includes(GMAIL_MODIFY_SCOPE);
}

function getThankYouBodyTemplate() {
  const fromEnv = process.env.THANK_YOU_DRAFT_BODY;
  if (fromEnv && String(fromEnv).trim()) return String(fromEnv).trim();
  return DEFAULT_THANK_YOU_BODY;
}

function buildThankYouBody(leadInfo, senderDisplayName) {
  const withSender = getThankYouBodyTemplate().replace(
    /\{\{\s*senderName\s*\}\}/gi,
    senderDisplayName || '',
  );
  return applyTemplatePlaceholders(withSender, leadInfo);
}

/**
 * Create a one-time thank-you draft in the Gmail thread when the lead replied
 * and the user has not sent a reply yet. Never auto-sends.
 *
 * @returns {Promise<'created'|'skipped'|'failed'>}
 */
async function maybeCreateThankYouDraft({ userId, campaignLead, accessToken, userEmail }) {
  if (!campaignLead?.gmail_thread_id) return 'skipped';
  if (campaignLead.thank_you_draft_gmail_id) return 'skipped';
  if (!campaignLead.reply_received) return 'skipped';

  const { data: googleAcct } = await supabase
    .from('google_accounts')
    .select('scopes, email')
    .eq('user_id', userId)
    .maybeSingle();

  if (!googleAcct || !hasGmailComposeScope(googleAcct.scopes)) {
    logger.warn('[ThankYouDraft] gmail.compose scope missing — reconnect Google', { userId });
    return 'skipped';
  }

  const { data: leadRow, error: ldErr } = await supabase
    .from('leads_data')
    .select('email, fullName, firstName')
    .eq('id', parseLeadDataId(campaignLead.lead_data_id))
    .maybeSingle();

  const leadEmail = leadRow?.email ? String(leadRow.email).trim() : null;
  if (ldErr || !leadEmail) return 'skipped';

  const userAlreadyReplied = await safeThreadHasUserReplyAfterLead({
    accessToken,
    threadId: campaignLead.gmail_thread_id,
    leadEmail,
    userEmail,
    outboundGmailMessageId: campaignLead.gmail_message_id,
  });

  if (userAlreadyReplied) {
    logger.info('[ThankYouDraft] User already replied in thread — skipping draft', {
      campaignLeadId: campaignLead.id,
    });
    return 'skipped';
  }

  const latestLead = await safeGetLatestLeadReplyInThread({
    accessToken,
    threadId: campaignLead.gmail_thread_id,
    leadEmail,
    userEmail,
    outboundGmailMessageId: campaignLead.gmail_message_id,
  });

  const inReplyTo =
    latestLead?.rfcMessageId ||
    (campaignLead.gmail_rfc_message_id
      ? normalizeMessageId(campaignLead.gmail_rfc_message_id)
      : null);

  const references = [campaignLead.gmail_rfc_message_id, latestLead?.rfcMessageId]
    .filter(Boolean)
    .map((r) => normalizeMessageId(r));

  const { data: campaign } = await supabase
    .from('campaigns')
    .select('sender_display_name, sender_address, sender_phone')
    .eq('id', campaignLead.campaign_id)
    .maybeSingle();

  const senderCampaign = campaign
    ? await resolveCampaignSenderForUser(campaign, userId)
    : { sender_display_name: null };

  const body = buildThankYouBody(leadRow, senderCampaign.sender_display_name);
  const subject = buildReplySubject(campaignLead.gmail_subject || 'Your message');

  const mimeOptions = {};
  const displayName = senderCampaign.sender_display_name
    ? String(senderCampaign.sender_display_name).trim()
    : '';
  const fromEmail = userEmail || googleAcct.email;
  if (displayName && fromEmail) {
    mimeOptions.fromDisplayName = displayName;
    mimeOptions.fromEmail = fromEmail;
  }

  let draftId;
  try {
    const draft = await createGmailDraft(accessToken, {
      to: leadEmail,
      subject,
      body,
      mimeOptions,
      threading: {
        threadId: campaignLead.gmail_thread_id,
        inReplyTo,
        references: references.length ? references : inReplyTo,
      },
    });
    draftId = draft.draftId;
  } catch (err) {
    logger.warn('[ThankYouDraft] Gmail draft create failed', {
      campaignLeadId: campaignLead.id,
      error: err.message,
    });
    return 'failed';
  }

  const { data: saved, error: saveErr } = await supabase
    .from('campaign_leads')
    .update({
      thank_you_draft_gmail_id: draftId,
      thank_you_draft_created_at: new Date().toISOString(),
    })
    .eq('id', campaignLead.id)
    .eq('user_id', userId)
    .is('thank_you_draft_gmail_id', null)
    .select('id')
    .maybeSingle();

  if (saveErr || !saved) {
    logger.warn('[ThankYouDraft] Draft created in Gmail but DB claim failed (may be duplicate)', {
      campaignLeadId: campaignLead.id,
      draftId,
      error: saveErr?.message,
    });
    return saved ? 'created' : 'skipped';
  }

  logger.info('[ThankYouDraft] Thank-you draft created (not sent)', {
    campaignLeadId: campaignLead.id,
    draftId,
    leadEmail,
  });

  return 'created';
}

const LEAD_SELECT =
  'id, user_id, campaign_id, lead_data_id, reply_received, gmail_thread_id, gmail_message_id, gmail_subject, gmail_rfc_message_id, thank_you_draft_gmail_id';

/**
 * After reply detection: create drafts for leads with reply_received and no draft yet.
 */
async function syncThankYouDraftsForUser(userId) {
  const summary = { checked: 0, created: 0, skipped: 0, failed: 0 };

  let accessToken;
  try {
    accessToken = await googleAuthService.getValidGoogleAccessToken(userId);
  } catch {
    return summary;
  }

  const { data: googleAcct } = await supabase
    .from('google_accounts')
    .select('email')
    .eq('user_id', userId)
    .maybeSingle();

  const userEmail = googleAcct?.email ? String(googleAcct.email).trim() : null;
  if (!userEmail) return summary;

  const { data: leads, error } = await supabase
    .from('campaign_leads')
    .select(LEAD_SELECT)
    .eq('user_id', userId)
    .eq('status', 'sent')
    .eq('reply_received', true)
    .is('thank_you_draft_gmail_id', null)
    .not('gmail_thread_id', 'is', null);

  if (error) {
    if (/thank_you_draft|column/i.test(error.message)) {
      logger.warn('[ThankYouDraft] thank_you_draft columns missing — run migration');
      return summary;
    }
    logger.error('[ThankYouDraft] Failed to load leads', { error: error.message });
    return summary;
  }

  for (const lead of leads || []) {
    summary.checked += 1;
    const result = await maybeCreateThankYouDraft({
      userId,
      campaignLead: lead,
      accessToken,
      userEmail,
    });
    if (result === 'created') summary.created += 1;
    else if (result === 'failed') summary.failed += 1;
    else summary.skipped += 1;
  }

  return summary;
}

async function syncThankYouDraftsBeforeFollowUps() {
  const { data: campaigns, error } = await supabase
    .from('campaigns')
    .select('user_id')
    .eq('status', 'active');

  if (error) return { users: 0, created: 0 };

  const userIds = [...new Set((campaigns || []).map((c) => c.user_id))];
  let created = 0;

  for (const userId of userIds) {
    const s = await syncThankYouDraftsForUser(userId);
    created += s.created;
  }

  if (created > 0) {
    logger.info('[ThankYouDraft] Sync complete', { users: userIds.length, created });
  }

  return { users: userIds.length, created };
}

module.exports = {
  maybeCreateThankYouDraft,
  syncThankYouDraftsForUser,
  syncThankYouDraftsBeforeFollowUps,
  hasGmailComposeScope,
  buildThankYouBody,
};
