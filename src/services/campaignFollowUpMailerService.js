const supabase = require('../config/supabase');
const { sendCustomEmail } = require('./emailService');
const googleAuthService = require('./googleAuthService');
const AppError = require('../utils/AppError');
const { parseLeadDataId } = require('../utils/leadDataId');
const { parseMailTemplate } = require('../utils/parseMailTemplate');
const { applyTemplatePlaceholders } = require('../utils/templatePlaceholders');
const logger = require('../utils/logger');
const { DAILY_SEND_LIMIT, getTodaySentCount } = require('./mailSendLimitService');

function appendCampaignSignature(body, campaign) {
  const lines = [];
  if (campaign.sender_address && String(campaign.sender_address).trim()) {
    lines.push(String(campaign.sender_address).trim());
  }
  if (campaign.sender_phone && String(campaign.sender_phone).trim()) {
    lines.push(String(campaign.sender_phone).trim());
  }
  if (lines.length === 0) return body;
  return `${body}\n\n--\n${lines.join('\n')}`;
}

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
async function sendFollowUpEmail({ userId, campaignId, campaignLeadId, followUpId }) {
  const claim = await claimFollowUpDelivery(campaignLeadId, followUpId);
  if (!claim.claimed) {
    return { status: 'skipped', reason: claim.reason };
  }

  const deliveryId = claim.id;

  const { data: campaignLead, error: clErr } = await supabase
    .from('campaign_leads')
    .select('id, lead_data_id, status, sent_at')
    .eq('id', campaignLeadId)
    .eq('campaign_id', campaignId)
    .eq('user_id', userId)
    .single();

  if (clErr || !campaignLead) {
    throw new AppError('Campaign lead not found.', 404);
  }
  if (campaignLead.status !== 'sent' || !campaignLead.sent_at) {
    await markFollowUpFailed(deliveryId, 'Initial email was not sent.');
    return { status: 'skipped', reason: 'lead_not_sent' };
  }

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
    .select('id, sender_display_name, sender_address, sender_phone')
    .eq('id', campaignId)
    .eq('user_id', userId)
    .single();

  if (campErr || !campaign) {
    throw new AppError('Campaign not found.', 404);
  }

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
  const mimeOptions = {};
  const displayName = campaign.sender_display_name ? String(campaign.sender_display_name).trim() : '';
  if (displayName && googleSendEmail) {
    mimeOptions.fromDisplayName = displayName;
    mimeOptions.fromEmail = googleSendEmail;
  }

  const templated = applyTemplatePlaceholders(bodyTemplate, leadInfo);
  const { subject: rawSubject, body: rawBody } = parseMailTemplate(templated);
  const subject = applyTemplatePlaceholders(rawSubject, leadInfo);
  const body = appendCampaignSignature(applyTemplatePlaceholders(rawBody, leadInfo), campaign);

  try {
    const hasMime = Object.keys(mimeOptions).length > 0;
    const { messageId } = await sendCustomEmail(
      leadInfo.email,
      subject,
      body,
      null,
      accessToken,
      hasMime ? mimeOptions : undefined
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
      messageId,
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
  appendCampaignSignature,
};
