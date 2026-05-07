const supabase            = require('../config/supabase');
const { sendCustomEmail } = require('./emailService');
const googleAuthService   = require('./googleAuthService');
const AppError            = require('../utils/AppError');
const logger              = require('../utils/logger');

// ─── Constants ────────────────────────────────────────────────────────────────

const DAILY_SEND_LIMIT = 500;

const DELAY_MIN_MS = Number(process.env.MAIL_DELAY_MIN_MS) || 10_000;
const DELAY_MAX_MS = Number(process.env.MAIL_DELAY_MAX_MS) || 60_000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function randomDelay() {
  const ms = Math.floor(Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS + 1)) + DELAY_MIN_MS;
  return new Promise((resolve) => setTimeout(() => resolve(ms), ms));
}

async function getTodaySentCount(userId) {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const { count, error } = await supabase
    .from('campaign_leads')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'sent')
    .gte('sent_at', todayStart.toISOString());

  if (error) {
    logger.warn('Failed to fetch today sent count', { userId, error: error.message });
    return 0;
  }

  return count || 0;
}

async function ensureFreshToken(userId, currentToken) {
  if (!userId) {
    return { token: currentToken, refreshed: false };
  }

  try {
    const freshToken = await googleAuthService.getValidGoogleAccessToken(userId);
    const refreshed  = freshToken !== currentToken;

    if (refreshed) {
      logger.info('[TokenRefresh] Access token refreshed automatically', { userId });
    }

    return { token: freshToken, refreshed };
  } catch (err) {
    logger.warn('[TokenRefresh] Failed to refresh access token — using existing token', {
      userId,
      error: err.message,
    });
    return { token: currentToken, refreshed: false };
  }
}

async function getLeadEmail(leadDataId) {
  const { data, error } = await supabase
    .from('leads_data')
    .select('email, fullName, firstName')
    .eq('id', Number(leadDataId))
    .single();

  if (error || !data) return null;
  return data;
}

function parseTemplate(template) {
  if (!template) return { subject: 'Hello', body: '' };

  const lines   = template.split('\n');
  let subject   = null;
  let bodyStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.toLowerCase().startsWith('subject:')) {
      subject   = trimmed.slice('subject:'.length).trim();
      bodyStart = i + 1;
      break;
    }
  }

  while (bodyStart < lines.length && lines[bodyStart].trim() === '') {
    bodyStart++;
  }

  const body = lines.slice(bodyStart).join('\n').trim();

  return {
    subject: subject || 'Reaching out',
    body,
  };
}

// ─── Main exported function ───────────────────────────────────────────────────

async function sendCampaignEmails(userId, campaignId, accessToken, campaignLeadId = null, autoRefreshToken = true) {
  // 1. Ownership check
  const { data: campaign, error: campError } = await supabase
    .from('campaigns')
    .select('id, name')
    .eq('id', campaignId)
    .eq('user_id', userId)
    .single();

  if (campError || !campaign) throw new AppError('Campaign not found.', 404);

  if (!accessToken) {
    throw new AppError('A valid Google OAuth access token is required to send emails.', 400);
  }

  // 2. Daily limit check
  const alreadySentToday = await getTodaySentCount(userId);
  const remaining        = DAILY_SEND_LIMIT - alreadySentToday;

  if (remaining <= 0) {
    logger.info('Daily send limit reached — no emails sent', {
      userId, campaignId, alreadySentToday, limit: DAILY_SEND_LIMIT,
    });
    return {
      sent: 0, failed: 0, skipped: 0,
      dailyLimitReached: true, alreadySentToday, dailyLimit: DAILY_SEND_LIMIT,
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
    .in('status', ['pending', 'template_generated', 'failed'])  // FIX: correct Supabase syntax + retry failed
    .order('created_at', { ascending: true })
    .limit(remaining);

  if (campaignLeadId) {
    clQuery = clQuery.eq('id', campaignLeadId);
  }

  const { data: leads, error: leadsError } = await clQuery;

  if (leadsError) throw new AppError('Failed to fetch campaign leads.', 500);
  if (!leads || leads.length === 0) {
    throw new AppError(
      'No leads with generated templates found. Run generate-templates first.',
      404,
    );
  }

  // 4. Send loop
  let sent    = 0;
  let failed  = 0;
  let skipped = 0;
  let tokensRefreshed = 0;
  const results = [];

  logger.info('Starting campaign email send', {
    campaignId, userId,
    totalToSend: leads.length, alreadySentToday, remainingBudget: remaining,
  });

  let activeToken = accessToken;

  for (let i = 0; i < leads.length; i++) {
    const cl = leads[i];

    // ── Refresh token before every send ───────────────────────────────────
    if (autoRefreshToken) {
      const { token, refreshed } = await ensureFreshToken(userId, activeToken);
      if (refreshed) {
        tokensRefreshed++;
        logger.info('Access token auto-refreshed before send', { campaignId, userId, sendIndex: i });
      }
      activeToken = token;
    }

    // ── a. Parse template ─────────────────────────────────────────────────
    const { subject, body } = parseTemplate(cl.mail_template);

    // ── b. Get lead email ─────────────────────────────────────────────────
    const leadInfo = await getLeadEmail(cl.lead_data_id);

    if (!leadInfo || !leadInfo.email) {
      logger.warn('Skipping lead — no email address found', {
        campaignLeadId: cl.id, lead_data_id: cl.lead_data_id,
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
      const { messageId } = await sendCustomEmail(
        leadInfo.email,
        subject,
        body,
        null,
        activeToken,
      );

      // ── d. Update status → sent ────────────────────────────────────────
      const sentAt = new Date().toISOString();

      await supabase
        .from('campaign_leads')
        .update({ status: 'sent', sent_at: sentAt, error_message: null })
        .eq('id', cl.id);

      await supabase
        .from('leads_data')
        .update({
          outreachStatus: 'contacted',
          emailSent:      'true',
          emailSentDate:  sentAt,
        })
        .eq('id', Number(cl.lead_data_id));

      sent++;

      logger.info('Email sent', {
        campaignLeadId: cl.id, lead_data_id: cl.lead_data_id,
        to: leadInfo.email, subject, messageId,
        sendNumber: sent, totalBudget: leads.length,
      });

      results.push({
        campaignLeadId: cl.id, status: 'sent',
        to: leadInfo.email, subject, messageId,
      });

    } catch (sendErr) {
      failed++;

      logger.error('Failed to send email', {
        campaignLeadId: cl.id, lead_data_id: cl.lead_data_id,
        to: leadInfo.email, error: sendErr.message,
      });

      await supabase
        .from('campaign_leads')
        .update({ status: 'failed', error_message: sendErr.message.slice(0, 500) })
        .eq('id', cl.id);

      results.push({
        campaignLeadId: cl.id, status: 'failed',
        to: leadInfo.email, error: sendErr.message,
      });
    }

    // ── e. Random delay before next send ──────────────────────────────────
    if (i < leads.length - 1) {
      const delayMs = await randomDelay();
      logger.debug('Inter-send delay', { delayMs, nextLeadIndex: i + 1 });
    }
  }

  const summary = {
    sent, failed, skipped, tokensRefreshed,
    total:             leads.length,
    dailyLimitReached: (alreadySentToday + sent) >= DAILY_SEND_LIMIT,
    alreadySentToday,
    totalSentToday:    alreadySentToday + sent,
    dailyLimit:        DAILY_SEND_LIMIT,
    results,
  };

  logger.info('Campaign email send complete', { campaignId, userId, ...summary });

  return summary;
}

module.exports = { sendCampaignEmails, DAILY_SEND_LIMIT };