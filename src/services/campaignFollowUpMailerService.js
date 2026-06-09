const OpenAI = require('openai');
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
const { safeThreadHasLeadReply, safeFetchThreadBodies } = require('./gmailThreadService');
const { maybeCreateThankYouDraft } = require('./thankYouDraftService');
const { buildReplySubject } = require('../utils/gmailThread');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const FOLLOW_UP_SYSTEM_PROMPT = `
You are an expert outbound sales email assistant.

Your job is to write short, natural follow-up emails for leads who have NOT replied yet.

RULES:
- Write concise, human-sounding emails.
- Keep body under 120 words.
- Sound like a real person, not a marketing automation tool.
- Use the PREVIOUSLY SENT EMAIL as the main source of context.
- Reference the previous outreach naturally without repeating it.
- Never sound desperate, pushy, or overly salesy.
- Avoid buzzwords and corporate language.
- Do not over-explain.
- Do not invent facts, pricing, claims, or details not present in context.
- If a follow-up template is provided, treat it only as style guidance.
- Replace placeholders naturally using provided lead data.
- Mention value briefly, then include a soft CTA.

GOOD FOLLOW-UP PATTERNS:
- gentle bump
- checking relevance
- quick clarification
- adding one extra piece of value
- simple question to restart conversation

AVOID:
- "Just following up"
- "Circling back"
- "Hope you're doing well"
- long paragraphs
- robotic personalization
- generic AI phrasing

EMAIL STYLE:
- 2–4 short paragraphs max
- conversational tone
- short sentences
- natural transitions

OUTPUT FORMAT:
Return ONLY:

Subject: <subject>

<email body>

Do not include explanations.
Do not use markdown.
Do not add signatures or contact footer.

If context is limited, generate a short professional generic follow-up based on the previous email topic.
`;


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

/**
 * Format thread messages into a readable conversation history for the AI prompt.
 * Trims long bodies to avoid token bloat.
 */
function formatThreadHistory(threadMessages, maxBodyLength = 400) {
  if (!threadMessages || threadMessages.length === 0) return null;

  return threadMessages
    .map((msg, i) => {
      const body = msg.body
        ? msg.body.slice(0, maxBodyLength) + (msg.body.length > maxBodyLength ? '…' : '')
        : '(no body)';
      return `[Message ${i + 1}]\nFrom: ${msg.from || 'Unknown'}\nDate: ${msg.date || 'Unknown'}\n${body}`;
    })
    .join('\n\n---\n\n');
}

/**
 * Extract just the body from a mail_template string (strips "Subject: ..." line).
 */
function extractBodyFromMailTemplate(mailTemplate) {
  if (!mailTemplate) return null;
  const lines = String(mailTemplate).split('\n');
  // Find the first blank line after the Subject: header
  const blankIndex = lines.findIndex(l => l.trim() === '');
  if (blankIndex !== -1 && blankIndex < lines.length - 1) {
    return lines.slice(blankIndex + 1).join('\n').trim();
  }
  // No Subject header found — return full template
  return mailTemplate.trim();
}

/**
 * Build the AI prompt for generating a contextual follow-up email.
 */
function buildFollowUpPrompt({
  leadInfo,
  campaign,
  followUpTemplate,
  threadHistory,
  originalMailBody,
}) {
  return `
LEAD INFORMATION
Name: ${leadInfo.fullName || leadInfo.firstName}
Email: ${leadInfo.email}

PREVIOUS EMAIL SENT
${originalMailBody || 'Not available'}

${threadHistory
      ? `
EMAIL THREAD HISTORY
${threadHistory}
`
      : ''
    }

${followUpTemplate
      ? `
FOLLOW-UP GUIDANCE TEMPLATE
Use this for tone and intent only.
Do NOT copy it directly.

${followUpTemplate}
`
      : ''
    }

TASK:
Write a contextual follow-up email for a lead who has not replied.

The follow-up should:
- feel personal
- reference prior outreach naturally
- be concise
- include a soft call to action
- avoid repeating the original email

Remember:
The previous sent email is the MOST IMPORTANT context.
`;
}

/**
 * Generate a contextual follow-up email body using the thread history and original mail.
 * Falls back to plain template substitution if AI call fails.
 */
async function generateFollowUpBody({ leadInfo, campaign, followUpTemplate, threadMessages, senderDisplayName, originalMailBody }) {
  const threadHistory = formatThreadHistory(threadMessages);

  const prompt = buildFollowUpPrompt({
    leadInfo,
    campaign,
    followUpTemplate,
    threadHistory,
    senderDisplayName,
    originalMailBody,
  });

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 1024,
      messages: [
        {
          role: 'system',
          content: FOLLOW_UP_SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const generated = response.choices[0].message.content.trim();
    logger.info('[FollowUpMailer] AI-generated follow-up', {
      leadEmail: leadInfo.email,
      hasThreadContext: !!threadHistory,
      hasOriginalMailContext: !!originalMailBody,
    });
    return generated;
  } catch (err) {
    logger.warn('[FollowUpMailer] AI generation failed — falling back to template', {
      error: err.message,
      leadEmail: leadInfo.email,
    });
    return null;
  }
}

/**
 * Send one plain-text follow-up email. Idempotent when delivery row is already `sent`.
 * @param {{ userId: string, campaignId: string, campaignLeadId: string, followUpId: string }} params
 */
async function sendFollowUpEmail({ userId, campaignId, campaignLeadId, followUpId }) {
  const { data: campaignLead, error: clErr } = await supabase
    .from('campaign_leads')
    .select(
      // ✅ Added mail_template so we can pass original email body to the AI
      'id, lead_data_id, status, sent_at, reply_received, gmail_thread_id, gmail_message_id, gmail_subject, gmail_rfc_message_id, mail_template'
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

  // Fetch live Gmail thread bodies for AI context (only if threaded)
  let threadMessages = [];
  if (campaignLead.gmail_thread_id) {
    threadMessages = await safeFetchThreadBodies(accessToken, campaignLead.gmail_thread_id);
  }

  // Extract the body from the stored mail_template for AI context.
  // This is the most reliable fallback — always available even if Gmail thread fetch is empty.
  const originalMailBody = extractBodyFromMailTemplate(campaignLead.mail_template);

  // Generate AI follow-up with full context: original mail + live thread + follow-up template
  const aiGenerated = await generateFollowUpBody({
    leadInfo,
    campaign: senderCampaign,
    followUpTemplate: bodyTemplate,
    threadMessages,
    senderDisplayName: displayName || null,
    originalMailBody,
  });

  let finalBody;
  if (aiGenerated) {
    // AI returned a full "Subject: ...\n\nbody" string — extract just the body
    const { body: aiBody } = parseMailTemplate(aiGenerated);
    finalBody = finalizeOutboundBody(aiBody, senderCampaign);
  } else {
    // Fallback: plain template substitution
    finalBody = finalizeOutboundBody(applyTemplatePlaceholders(rawBody, leadInfo), senderCampaign);
  }

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
      finalBody,
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