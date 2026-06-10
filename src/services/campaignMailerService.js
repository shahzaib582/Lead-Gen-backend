const supabase = require('../config/supabase');
const { sendCustomEmail } = require('./emailService');
const googleAuthService = require('./googleAuthService');
const AppError = require('../utils/AppError');
const { parseLeadDataId } = require('../utils/leadDataId');
const logger = require('../utils/logger');
const { randomDelayMs } = require('../config/mailDelay');
const { parseMailTemplate } = require('../utils/parseMailTemplate');
const { finalizeOutboundBody } = require('../utils/senderSignature');
const { resolveCampaignSenderForUser } = require('../utils/resolveCampaignSender');
const { DAILY_SEND_LIMIT, getTodaySentCount } = require('./mailSendLimitService');
const { assertCampaignActiveForSend } = require('./campaignSendRules');
const { safeFetchGmailMessageMetadata } = require('./gmailThreadService');
const {
  createOpenTrackingToken,
  buildTrackedHtmlEmail,
} = require('../utils/emailOpenTracking');
const { scheduleReplySyncForUser } = require('./gmailReplyDetectionService');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function randomDelay() {
  const ms = randomDelayMs();
  return new Promise((resolve) => setTimeout(() => resolve(ms), ms));
}

async function ensureFreshToken(userId, currentToken) {
  if (!userId) {
    return { token: currentToken, refreshed: false, errorCode: undefined };
  }

  try {
    const freshToken = await googleAuthService.getValidGoogleAccessToken(userId);
    const refreshed = freshToken !== currentToken;

    return { token: freshToken, refreshed, errorCode: undefined };
  } catch (err) {
    logger.warn('[TokenRefresh] Failed to refresh access token — using existing token', {
      userId,
      error: err.message,
      code: err.code,
    });
    return { token: currentToken, refreshed: false, errorCode: err.code };
  }
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

// ─── Main exported function ───────────────────────────────────────────────────

async function sendCampaignEmails(
  userId,
  campaignId,
  accessToken,
  campaignLeadId = null,
  autoRefreshToken = true
) {
  // 1. Ownership check
  const { data: campaign, error: campError } = await supabase
    .from('campaigns')
    .select('id, name, status, sender_display_name, sender_address, sender_phone')
    .eq('id', campaignId)
    .eq('user_id', userId)
    .single();

  if (campError || !campaign) throw new AppError('Campaign not found.', 404);
  assertCampaignActiveForSend(campaign);

  const senderCampaign = await resolveCampaignSenderForUser(campaign, userId);

  const { data: googleAcct } = await supabase
    .from('google_accounts')
    .select('email')
    .eq('user_id', userId)
    .maybeSingle();

  const googleSendEmail = googleAcct && googleAcct.email ? String(googleAcct.email).trim() : null;

  const mimeOptions = {};
  const displayName = senderCampaign.sender_display_name
    ? String(senderCampaign.sender_display_name).trim()
    : '';
  if (displayName && googleSendEmail) {
    mimeOptions.fromDisplayName = displayName;
    mimeOptions.fromEmail = googleSendEmail;
  }

  if (!accessToken) {
    throw new AppError('A valid Google OAuth access token is required to send emails.', 400);
  }

  // 2. Daily limit check
  const alreadySentToday = await getTodaySentCount(userId);
  const remaining = DAILY_SEND_LIMIT - alreadySentToday;

  if (remaining <= 0) {
    return {
      sent: 0,
      failed: 0,
      skipped: 0,
      dailyLimitReached: true,
      alreadySentToday,
      dailyLimit: DAILY_SEND_LIMIT,
    };
  }

  // 3. FIX: Fetch leads with template that are NOT yet sent or skipped.
  //    This includes 'pending', 'template_generated', AND 'failed' (for retries).
  let clQuery = supabase
    .from('campaign_leads')
    .select('id, lead_data_id, mail_template')
    .eq('campaign_id', campaignId)
    .eq('user_id', userId)
    .not('mail_template', 'is', null)
    .neq('mail_template', '')
    .in('status', ['pending', 'template_generated', 'failed']) // FIX: correct Supabase syntax + retry failed
    .order('created_at', { ascending: true })
    .limit(remaining);

  if (campaignLeadId) {
    // When targeting a specific lead, only allow template_generated.
    // This prevents re-sending to a lead that is already 'sent' or 'skipped'.
    clQuery = clQuery.eq('id', campaignLeadId).eq('status', 'template_generated');
  }

  const { data: leads, error: leadsError } = await clQuery;

  if (leadsError) throw new AppError('Failed to fetch campaign leads.', 500);
  if (!leads || leads.length === 0) {
    throw new AppError(
      'No leads with generated templates found. Run generate-templates first.',
      404
    );
  }

  // 4. Send loop
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let tokensRefreshed = 0;
  const results = [];

  let activeToken = accessToken;
  let googleAuthError = null;

  for (let i = 0; i < leads.length; i++) {
    const cl = leads[i];

    // ── Refresh token before every send ───────────────────────────────────
    if (autoRefreshToken) {
      const { token, refreshed, errorCode } = await ensureFreshToken(userId, activeToken);
      if (refreshed) {
        tokensRefreshed++;
      }
      if (errorCode && !refreshed) {
        googleAuthError = { code: errorCode, message: 'Google token could not be refreshed; using caller token.' };
      }
      activeToken = token;
    }

    // ── a. Parse template ─────────────────────────────────────────────────
    const { subject, body: rawBody } = parseMailTemplate(cl.mail_template);
    const body = finalizeOutboundBody(rawBody, senderCampaign);

    // ── b. Get lead email ─────────────────────────────────────────────────
    const leadInfo = await getLeadEmail(cl.lead_data_id);

    if (!leadInfo || !leadInfo.email) {
      logger.warn('Skipping lead — no email address found', {
        campaignLeadId: cl.id,
        lead_data_id: cl.lead_data_id,
      });

      await supabase
        .from('campaign_leads')
        .update({ status: 'skipped', error_message: 'No email address found in leads_data.' })
        .eq('id', cl.id);

      skipped++;
      results.push({ campaignLeadId: cl.id, status: 'skipped', reason: 'No email' });
      continue;
    }

    // ── c. Send via Gmail API ─────────────────────────────────────────────
    try {
      const hasMime = Object.keys(mimeOptions).length > 0;
      const openTrackingToken = createOpenTrackingToken();
      const htmlBody = buildTrackedHtmlEmail(body, openTrackingToken);
      const sendResult = await sendCustomEmail(
        leadInfo.email,
        subject,
        body,
        htmlBody,
        activeToken,
        hasMime ? mimeOptions : undefined
      );

      const meta = await safeFetchGmailMessageMetadata(activeToken, sendResult.messageId);

      // ── d. Update status → sent (+ Gmail thread for follow-ups) ─────────
      const sentAt = new Date().toISOString();

      await supabase
        .from('campaign_leads')
        .update({
          status: 'sent',
          sent_at: sentAt,
          error_message: null,
          gmail_message_id: sendResult.messageId,
          gmail_thread_id: sendResult.threadId,
          gmail_subject: meta.subject || subject,
          gmail_rfc_message_id: meta.rfcMessageId,
          open_tracking_token: openTrackingToken,
        })
        .eq('id', cl.id);

      await supabase
        .from('leads_data')
        .update({
          outreachStatus: 'contacted',
          emailSent: 'true',
          emailSentDate: sentAt,
        })
        .eq('id', parseLeadDataId(cl.lead_data_id));

      sent++;

      results.push({
        campaignLeadId: cl.id,
        status: 'sent',
        to: leadInfo.email,
        subject,
        messageId: sendResult.messageId,
        threadId: sendResult.threadId,
      });
    } catch (sendErr) {
      failed++;

      logger.error('Failed to send email', {
        campaignLeadId: cl.id,
        lead_data_id: cl.lead_data_id,
        to: leadInfo.email,
        error: sendErr.message,
        code: sendErr.code,
      });

      const errMsg =
        sendErr.code && sendErr.message
          ? `[${sendErr.code}] ${sendErr.message}`
          : sendErr.message;
      await supabase
        .from('campaign_leads')
        .update({ status: 'failed', error_message: errMsg.slice(0, 500) })
        .eq('id', cl.id);

      results.push({
        campaignLeadId: cl.id,
        status: 'failed',
        to: leadInfo.email,
        error: sendErr.message,
        fatalCode: sendErr.code,
      });
    }

    // ── e. Random delay before next send ──────────────────────────────────
    if (i < leads.length - 1) {
      await randomDelay();
    }
  }

  const summary = {
    sent,
    failed,
    skipped,
    tokensRefreshed,
    total: leads.length,
    dailyLimitReached: alreadySentToday + sent >= DAILY_SEND_LIMIT,
    alreadySentToday,
    totalSentToday: alreadySentToday + sent,
    dailyLimit: DAILY_SEND_LIMIT,
    results,
    ...(googleAuthError ? { googleError: googleAuthError } : {}),
  };

  if (sent > 0) {
    scheduleReplySyncForUser(userId, { campaignId });
  }

  return summary;
}

module.exports = { sendCampaignEmails, DAILY_SEND_LIMIT, getTodaySentCount };
