const supabase        = require('../config/supabase');
const { sendCustomEmail } = require('./emailService');
const AppError        = require('../utils/AppError');
const logger          = require('../utils/logger');

// ─── Constants ────────────────────────────────────────────────────────────────

const DAILY_SEND_LIMIT = 500;

/**
 * Random delay between MIN and MAX milliseconds.
 * Mimics human sending behaviour to avoid spam filters.
 * Range: 10s – 60s (adjustable via env)
 */
const DELAY_MIN_MS = Number(process.env.MAIL_DELAY_MIN_MS) || 10_000;  // 10 seconds
const DELAY_MAX_MS = Number(process.env.MAIL_DELAY_MAX_MS) || 60_000;  // 60 seconds

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Sleep for a random duration between DELAY_MIN_MS and DELAY_MAX_MS.
 * Returns the actual milliseconds waited (useful for logging).
 */
function randomDelay() {
  const ms = Math.floor(Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS + 1)) + DELAY_MIN_MS;
  return new Promise((resolve) => setTimeout(() => resolve(ms), ms));
}

/**
 * Count how many emails have already been sent today (UTC day boundary)
 * for this user across ALL campaigns.
 *
 * We rely on campaign_leads.sent_at which is set when status → 'sent'.
 */
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
    return 0; // Fail open — don't block sending if the count query fails
  }

  return count || 0;
}

/**
 * Fetch the lead's email address from leads_data by lead_data_id.
 */
async function getLeadEmail(leadDataId) {
  const { data, error } = await supabase
    .from('leads_data')
    .select('email, fullName, firstName')
    .eq('id', Number(leadDataId))
    .single();

  if (error || !data) return null;
  return data;
}

/**
 * Parse subject + body from a generated mail_template string.
 *
 * Expected format produced by mailTemplateService / OpenAI:
 *   Subject: <subject line here>
 *
 *   <email body …>
 *
 * Returns { subject, body }.
 * Falls back to a generic subject if the line is missing.
 */
function parseTemplate(template) {
  if (!template) return { subject: 'Hello', body: '' };

  const lines  = template.split('\n');
  let subject  = null;
  let bodyStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.toLowerCase().startsWith('subject:')) {
      subject   = trimmed.slice('subject:'.length).trim();
      bodyStart = i + 1;
      break;
    }
  }

  // Skip blank lines right after subject
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

/**
 * Send emails to all pending campaign leads that already have a mail_template.
 *
 * Flow:
 *  1. Verify campaign ownership.
 *  2. Check today's sent count — stop if already at 500.
 *  3. Fetch pending leads WITH a mail_template (generated).
 *  4. For each lead (up to the remaining daily budget):
 *     a. Parse subject + body from mail_template.
 *     b. Fetch lead email from leads_data.
 *     c. Send via Gmail API (sendCustomEmail).
 *     d. Update campaign_leads → status:'sent', sent_at: now.
 *     e. Wait a random delay before the next send.
 *  5. Return a summary { sent, failed, skipped, dailyLimitReached }.
 *
 * @param {string} userId
 * @param {string} campaignId
 * @param {string} accessToken   — Google OAuth2 access token for the sending user
 * @param {string|null} campaignLeadId — optional: target a single lead
 */
async function sendCampaignEmails(userId, campaignId, accessToken, campaignLeadId = null) {
  // 1. Ownership check
  const { data: campaign, error: campError } = await supabase
    .from('campaigns')
    .select('id, name')
    .eq('id', campaignId)
    .eq('user_id', userId)
    .single();

  if (campError || !campaign) throw new AppError('Campaign not found.', 404);

  if (!accessToken) {
    throw new AppError(
      'A valid Google OAuth access token is required to send emails.',
      400,
    );
  }

  // 2. Daily limit check
  const alreadySentToday = await getTodaySentCount(userId);
  const remaining        = DAILY_SEND_LIMIT - alreadySentToday;

  if (remaining <= 0) {
    logger.info('Daily send limit reached — no emails sent', {
      userId,
      campaignId,
      alreadySentToday,
      limit: DAILY_SEND_LIMIT,
    });
    return {
      sent:              0,
      failed:            0,
      skipped:           0,
      dailyLimitReached: true,
      alreadySentToday,
      dailyLimit:        DAILY_SEND_LIMIT,
    };
  }

  // 3. Fetch pending leads that have a generated template
  let clQuery = supabase
    .from('campaign_leads')
    .select('id, lead_data_id, mail_template')
    .eq('campaign_id', campaignId)
    .eq('user_id', userId)
    .eq('status', 'pending')
    .not('mail_template', 'is', null)
    .neq('mail_template', '')
    .order('created_at', { ascending: true })
    .limit(remaining); // Never fetch more than we're allowed to send today

  if (campaignLeadId) {
    clQuery = clQuery.eq('id', campaignLeadId);
  }

  const { data: leads, error: leadsError } = await clQuery;

  if (leadsError) throw new AppError('Failed to fetch campaign leads.', 500);
  if (!leads || leads.length === 0) {
    throw new AppError(
      'No pending leads with generated templates found. Run generate-templates first.',
      404,
    );
  }

  // 4. Send loop
  let sent    = 0;
  let failed  = 0;
  let skipped = 0;
  const results = [];

  logger.info('Starting campaign email send', {
    campaignId,
    userId,
    totalToSend:       leads.length,
    alreadySentToday,
    remainingBudget:   remaining,
  });

  for (let i = 0; i < leads.length; i++) {
    const cl = leads[i];

    // ── a. Parse template ─────────────────────────────────────────────────
    const { subject, body } = parseTemplate(cl.mail_template);

    // ── b. Get lead email ─────────────────────────────────────────────────
    const leadInfo = await getLeadEmail(cl.lead_data_id);

    if (!leadInfo || !leadInfo.email) {
      logger.warn('Skipping lead — no email address found', {
        campaignLeadId: cl.id,
        lead_data_id:   cl.lead_data_id,
      });

      // Mark as skipped so we don't retry endlessly
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
        null,          // html — plain text only; set to body if you have HTML
        accessToken,
      );

      // ── d. Update status → sent ────────────────────────────────────────
      const sentAt = new Date().toISOString();

      await supabase
        .from('campaign_leads')
        .update({ status: 'sent', sent_at: sentAt })
        .eq('id', cl.id);

      // Mirror to leads_data (outreachStatus, emailSent, emailSentDate)
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
        campaignLeadId: cl.id,
        lead_data_id:   cl.lead_data_id,
        to:             leadInfo.email,
        subject,
        messageId,
        sendNumber:     sent,
        totalBudget:    leads.length,
      });

      results.push({
        campaignLeadId: cl.id,
        status:         'sent',
        to:             leadInfo.email,
        subject,
        messageId,
      });

    } catch (sendErr) {
      failed++;

      logger.error('Failed to send email', {
        campaignLeadId: cl.id,
        lead_data_id:   cl.lead_data_id,
        to:             leadInfo.email,
        error:          sendErr.message,
      });

      await supabase
        .from('campaign_leads')
        .update({ status: 'failed', error_message: sendErr.message.slice(0, 500) })
        .eq('id', cl.id);

      results.push({
        campaignLeadId: cl.id,
        status:         'failed',
        to:             leadInfo.email,
        error:          sendErr.message,
      });
    }

    // ── e. Random delay before next send (skip delay after the last email) ─
    if (i < leads.length - 1) {
      const delayMs = await randomDelay();
      logger.debug('Inter-send delay', {
        delayMs,
        nextLeadIndex: i + 1,
      });
    }
  }

  const summary = {
    sent,
    failed,
    skipped,
    total:             leads.length,
    dailyLimitReached: (alreadySentToday + sent) >= DAILY_SEND_LIMIT,
    alreadySentToday,
    totalSentToday:    alreadySentToday + sent,
    dailyLimit:        DAILY_SEND_LIMIT,
    results,
  };

  logger.info('Campaign email send complete', {
    campaignId,
    userId,
    ...summary,
  });

  return summary;
}

module.exports = { sendCampaignEmails, DAILY_SEND_LIMIT };