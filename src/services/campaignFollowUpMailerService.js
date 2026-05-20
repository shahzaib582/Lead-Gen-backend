const supabase = require('../config/supabase');
const { sendCustomEmail } = require('./emailService');
const googleAuthService = require('./googleAuthService');
const AppError = require('../utils/AppError');
const { parseLeadDataId } = require('../utils/leadDataId');
const { parseMailTemplate } = require('../utils/parseMailTemplate');
const { applyTemplatePlaceholders } = require('../utils/templatePlaceholders');
const { finalizeOutboundBody } = require('../utils/senderSignature');
const { resolveCampaignSenderForUser } = require('../utils/resolveCampaignSender');
const logger = require('../utils/logger');
const { DAILY_SEND_LIMIT, getTodaySentCount } = require('./mailSendLimitService');
const { assertCampaignActiveForSend } = require('./campaignSendRules');
const { safeThreadHasLeadReply } = require('./gmailThreadService');
const { maybeCreateThankYouDraft } = require('./thankYouDraftService');
const { buildReplySubject } = require('../utils/gmailThread');

async function getLeadEmail(leadDataId) {
  const { data, error } = await supabase
    .from('leads_data')
    .select('email, fullName, firstName')
    .eq('id', parseLeadDataId(leadDataId))
    .single();

  if (error || !data) return null;
  return data;
}

/**
 * @returns {Promise<{ claimed: boolean, id?: string, reason?: string }>}
 */
async function claimFollowUpDelivery(campaignLeadId, followUpId) {
  const { data: existing, error: fetchErr } = await supabase
    .from('campaign_lead_follow_ups')
    .select('id, status')
    .eq('campaign_lead_id', campaignLeadId)
    .eq('follow_up_id', followUpId)
    .maybeSingle();

  if (fetchErr) throw new AppError('Failed to check follow-up delivery state.', 500);
  if (existing?.status === 'sent') {
    return { claimed: false, reason: 'already_sent', id: existing.id };
  }
  if (existing) {
    return { claimed: true, id: existing.id };
  }

  const { data, error } = await supabase
    .from('campaign_lead_follow_ups')
    .insert({
      campaign_lead_id: campaignLeadId,
      follow_up_id: followUpId,
      status: 'pending',
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      const { data: race } = await supabase
        .from('campaign_lead_follow_ups')
        .select('id, status')
        .eq('campaign_lead_id', campaignLeadId)
        .eq('follow_up_id', followUpId)
        .maybeSingle();
      if (race?.status === 'sent') {
        return { claimed: false, reason: 'already_sent', id: race.id };
      }
      if (race) return { claimed: true, id: race.id };
    }
    throw new AppError(error.message || 'Failed to claim follow-up delivery.', 500);
  }

  return { claimed: true, id: data.id };
}

/**
 * Send one plain-text follow-up email. Idempotent when delivery row is already `sent`.
 * @param {{ userId: string, campaignId: string, campaignLeadId: string, followUpId: string }} params
 */
async function markLeadReplyReceived(campaignLeadId, userId) {
  await supabase
    .from('campaign_leads')
    .update({
      reply_received: true,
      reply_received_at: new Date().toISOString(),
    })
    .eq('id', campaignLeadId)
    .eq('user_id', userId);

  const { data: row } = await supabase
    .from('campaign_leads')
    .select(
      'id, campaign_id, lead_data_id, reply_received, gmail_thread_id, gmail_message_id, gmail_subject, gmail_rfc_message_id, thank_you_draft_gmail_id'
    )
    .eq('id', campaignLeadId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!row?.gmail_thread_id) return;

  try {
    const accessToken = await googleAuthService.getValidGoogleAccessToken(userId);
    const { data: googleAcct } = await supabase
      .from('google_accounts')
      .select('email')
      .eq('user_id', userId)
      .maybeSingle();
    const userEmail = googleAcct?.email ? String(googleAcct.email).trim() : null;
    if (!userEmail) return;

    await maybeCreateThankYouDraft({
      userId,
      campaignLead: row,
      accessToken,
      userEmail,
    });
  } catch (err) {
    logger.warn('[ThankYouDraft] Failed after markLeadReplyReceived', {
      campaignLeadId,
      error: err.message,
    });
  }
}

async function sendFollowUpEmail({ userId, campaignId, campaignLeadId, followUpId }) {
  const { data: campaignLead, error: clErr } = await supabase
    .from('campaign_leads')
    .select(
      'id, lead_data_id, status, sent_at, reply_received, gmail_thread_id, gmail_message_id, gmail_subject, gmail_rfc_message_id'
    )
    .eq('id', campaignLeadId)
    .eq('campaign_id', campaignId)
    .eq('user_id', userId)
    .single();

  if (clErr || !campaignLead) {
    throw new AppError('Campaign lead not found.', 404);
  }
  if (campaignLead.status !== 'sent' || !campaignLead.sent_at) {
    return { status: 'skipped', reason: 'lead_not_sent' };
  }

  if (campaignLead.reply_received) {
    return { status: 'skipped', reason: 'reply_received' };
  }

  const claim = await claimFollowUpDelivery(campaignLeadId, followUpId);
  if (!claim.claimed) {
    return { status: 'skipped', reason: claim.reason };
  }

  const deliveryId = claim.id;

  const { data: followUp, error: fuErr } = await supabase
    .from('campaign_follow_ups')
    .select('id, body_template, waiting_days, name')
    .eq('id', followUpId)
    .eq('campaign_id', campaignId)
    .single();

  if (fuErr || !followUp) {
    throw new AppError('Follow-up not found.', 404);
  }

  const bodyTemplate = followUp.body_template ? String(followUp.body_template).trim() : '';
  if (!bodyTemplate) {
    await markFollowUpFailed(deliveryId, 'Follow-up has no body_template.');
    return { status: 'skipped', reason: 'no_template' };
  }

  const { data: campaign, error: campErr } = await supabase
    .from('campaigns')
    .select('id, status, sender_display_name, sender_address, sender_phone')
    .eq('id', campaignId)
    .eq('user_id', userId)
    .single();

  if (campErr || !campaign) {
    throw new AppError('Campaign not found.', 404);
  }
  assertCampaignActiveForSend(campaign);

  const senderCampaign = await resolveCampaignSenderForUser(campaign, userId);

  const alreadySentToday = await getTodaySentCount(userId);
  if (alreadySentToday >= DAILY_SEND_LIMIT) {
    return { status: 'skipped', reason: 'daily_limit_reached' };
  }

  const leadInfo = await getLeadEmail(campaignLead.lead_data_id);
  if (!leadInfo?.email) {
    await markFollowUpFailed(deliveryId, 'No email address found in leads_data.');
    return { status: 'skipped', reason: 'no_email' };
  }

  let accessToken;
  try {
    accessToken = await googleAuthService.getValidGoogleAccessToken(userId);
  } catch (err) {
    await markFollowUpFailed(deliveryId, err.message || 'Google token unavailable.');
    throw err;
  }

  const { data: googleAcct } = await supabase
    .from('google_accounts')
    .select('email')
    .eq('user_id', userId)
    .maybeSingle();

  const googleSendEmail = googleAcct?.email ? String(googleAcct.email).trim() : null;

  if (campaignLead.gmail_thread_id && leadInfo.email && googleSendEmail) {
    const hasReply = await safeThreadHasLeadReply({
      accessToken,
      threadId: campaignLead.gmail_thread_id,
      leadEmail: leadInfo.email,
      userEmail: googleSendEmail,
      outboundGmailMessageId: campaignLead.gmail_message_id,
    });
    if (hasReply) {
      await markLeadReplyReceived(campaignLeadId, userId);
      await markFollowUpFailed(deliveryId, 'Lead replied; follow-up skipped.');
      return { status: 'skipped', reason: 'reply_received' };
    }
  }
  const mimeOptions = {};
  const displayName = senderCampaign.sender_display_name
    ? String(senderCampaign.sender_display_name).trim()
    : '';
  if (displayName && googleSendEmail) {
    mimeOptions.fromDisplayName = displayName;
    mimeOptions.fromEmail = googleSendEmail;
  }

  const templated = applyTemplatePlaceholders(bodyTemplate, leadInfo);
  const { subject: rawSubject, body: rawBody } = parseMailTemplate(templated);
  const templateSubject = applyTemplatePlaceholders(rawSubject, leadInfo);
  const anchorSubject = campaignLead.gmail_subject || templateSubject;
  const subject = campaignLead.gmail_thread_id
    ? buildReplySubject(anchorSubject)
    : templateSubject;
  const body = finalizeOutboundBody(applyTemplatePlaceholders(rawBody, leadInfo), senderCampaign);

  const threading =
    campaignLead.gmail_thread_id && campaignLead.gmail_rfc_message_id
      ? {
          threadId: campaignLead.gmail_thread_id,
          inReplyTo: campaignLead.gmail_rfc_message_id,
          references: campaignLead.gmail_rfc_message_id,
        }
      : campaignLead.gmail_thread_id
        ? { threadId: campaignLead.gmail_thread_id }
        : undefined;

  try {
    const hasMime = Object.keys(mimeOptions).length > 0;
    const sendResult = await sendCustomEmail(
      leadInfo.email,
      subject,
      body,
      null,
      accessToken,
      hasMime ? mimeOptions : undefined,
      threading
    );

    const sentAt = new Date().toISOString();
    await supabase
      .from('campaign_lead_follow_ups')
      .update({ status: 'sent', sent_at: sentAt, error_message: null })
      .eq('id', deliveryId);

    return {
      status: 'sent',
      to: leadInfo.email,
      subject,
      messageId: sendResult.messageId,
      threadId: sendResult.threadId,
      followUpName: followUp.name,
    };
  } catch (sendErr) {
    const errMsg =
      sendErr.code && sendErr.message
        ? `[${sendErr.code}] ${sendErr.message}`
        : sendErr.message;
    await markFollowUpFailed(deliveryId, errMsg);
    logger.error('Follow-up send failed', {
      campaignLeadId,
      followUpId,
      error: sendErr.message,
    });
    return { status: 'failed', error: sendErr.message };
  }
}

async function markFollowUpFailed(deliveryId, message) {
  await supabase
    .from('campaign_lead_follow_ups')
    .update({
      status: 'failed',
      error_message: String(message || 'Send failed.').slice(0, 500),
    })
    .eq('id', deliveryId);
}

module.exports = {
  sendFollowUpEmail,
  claimFollowUpDelivery,
};
