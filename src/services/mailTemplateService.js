const OpenAI = require('openai');
const supabase = require('../config/supabase');
const AppError = require('../utils/AppError');
const { formatMailTemplateSamplesForPrompt } = require('../utils/mailTemplateSamples');
const { parseLeadDataId } = require('../utils/leadDataId');
const logger = require('../utils/logger');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fetchLeadData(leadDataId) {
  const { data, error } = await supabase
    .from('leads_data')
    .select('*')
    .eq('id', parseLeadDataId(leadDataId))
    .single();

  if (error || !data) return null;
  return data;
}

async function fetchLinkedinData(linkedinUrl) {
  if (!linkedinUrl) return null;

  const { data, error } = await supabase
    .from('linkedinscrapping')
    .select('*')
    .eq('linkedin_url', linkedinUrl)
    .maybeSingle();

  if (error) {
    logger.warn('LinkedIn lookup failed', { linkedinUrl, error: error.message });
    return null;
  }
  return data || null;
}

async function fetchWebData(domain) {
  if (!domain) return null;

  const { data, error } = await supabase
    .from('webscrapping')
    .select('*')
    .eq('domain', domain)
    .maybeSingle();

  if (error) {
    logger.warn('Web scraping lookup failed', { domain, error: error.message });
    return null;
  }
  return data || null;
}

function buildPrompt({
  lead,
  linkedin,
  web,
  mailTrainingInstruction,
  formattedSamples,
  campaignGoal,
  callToAction,
  targetTone,
}) {
  const sections = [];

  sections.push(
    `## Campaign Context\nGoal: ${campaignGoal || 'Not specified'}\nCall to Action: ${callToAction || 'Not specified'}\nTarget tone: ${targetTone || 'Professional'}\n${mailTrainingInstruction ? `Instructions for tone and style:\n${mailTrainingInstruction}` : ''}`
  );

  if (formattedSamples) {
    sections.push(
      `## Reference email samples\nMatch tone, structure, and placeholder style from these examples. Personalise for the lead using only verified facts:\n\n${formattedSamples}`
    );
  }

  const leadFields = [
    lead.fullName && `Full Name: ${lead.fullName}`,
    lead.firstName && `First Name: ${lead.firstName}`,
    lead.lastName && `Last Name: ${lead.lastName}`,
    lead.title && `Job Title: ${lead.title}`,
    lead.email && `Email: ${lead.email}`,
    lead.company && `Company: ${lead.company}`,
    lead.industry && `Industry: ${lead.industry}`,
    lead.seniority && `Seniority: ${lead.seniority}`,
    lead.department && `Department: ${lead.department}`,
    lead.city && `City: ${lead.city}`,
    lead.state && `State: ${lead.state}`,
    lead.country && `Country: ${lead.country}`,
    lead.employees && `Company Size: ${lead.employees} employees`,
    lead.revenue && `Revenue: ${lead.revenue}`,
    lead.fitTag && `Fit Tag: ${lead.fitTag}`,
    lead.fitScore && `Fit Score: ${lead.fitScore}`,
    lead.fitReason && `Fit Reason: ${lead.fitReason}`,
    lead.notes && `Notes: ${lead.notes}`,
  ].filter(Boolean);

  if (leadFields.length) {
    sections.push(`## Lead Information\n${leadFields.join('\n')}`);
  }

  if (linkedin) {
    const liFields = [
      linkedin.headline && `Headline: ${linkedin.headline}`,
      linkedin.summary && `Summary: ${linkedin.summary}`,
      linkedin.location && `Location: ${linkedin.location}`,
      linkedin.follower_count && `Followers: ${linkedin.follower_count}`,
      linkedin.connections_count && `Connections: ${linkedin.connections_count}`,
      linkedin.current_company && `Current Company: ${linkedin.current_company}`,
    ].filter(Boolean);

    if (Array.isArray(linkedin.experience) && linkedin.experience.length) {
      const expText = linkedin.experience
        .slice(0, 3)
        .map((e) => `  • ${e.title || ''} at ${e.company || ''} (${e.duration || ''})`)
        .join('\n');
      liFields.push(`Recent Experience:\n${expText}`);
    }

    if (liFields.length) {
      sections.push(`## LinkedIn Profile\n${liFields.join('\n')}`);
    }
  }

  if (web && web.llmresponse) {
    sections.push(`## Company Website Intelligence\n${web.llmresponse}`);
  }

  sections.push(
    `## Your Task\nWrite a personalised, human-sounding cold email for this specific lead.\n\nRules:\n- Match the **Target tone** (${targetTone || 'Professional'}) throughout subject and body.\n- Use ONLY the information provided above — do not invent facts.\n- Replace every placeholder in the template (e.g. {{firstName}}, {{company}}) with the real values.\n- Weave in 1–2 specific details from the LinkedIn profile or company intelligence to show genuine research.\n- Keep it concise (under 200 words for the body).\n- End with a clear, single call to action: "${callToAction || 'Reply to this email'}".\n- Output ONLY the final email text (subject line first, then body). No explanation, no markdown fencing.\n- Subject line format:  Subject: <your subject here>\n- Then a blank line, then the email body.`
  );

  return sections.join('\n\n');
}

async function generateEmailForLead({ lead, linkedin, web, campaign }) {
  const formattedSamples = formatMailTemplateSamplesForPrompt(campaign.mail_template_samples);

  const prompt = buildPrompt({
    lead,
    linkedin,
    web,
    mailTrainingInstruction: campaign.mail_training_instruction,
    formattedSamples,
    campaignGoal: campaign.goal,
    callToAction: campaign.call_to_action,
    targetTone: campaign.target_tone,
  });

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.choices[0].message.content.trim();
}

// ─── Main exported function ───────────────────────────────────────────────────

async function generateMailTemplates(userId, campaignId, campaignLeadId = null) {
  // 1. Fetch campaign (with ownership check)
  const { data: campaign, error: campError } = await supabase
    .from('campaigns')
    .select('id, goal, call_to_action, target_tone, mail_training_instruction, mail_template_samples')
    .eq('id', campaignId)
    .eq('user_id', userId)
    .single();

  if (campError || !campaign) throw new AppError('Campaign not found.', 404);

  // 2. Fetch the campaign_leads to process
  // FIX: only fetch 'pending' leads (not template_generated/sent/failed)
  let clQuery = supabase
    .from('campaign_leads')
    .select('id, lead_data_id')
    .eq('campaign_id', campaignId)
    .eq('user_id', userId)
    .eq('status', 'pending');

  if (campaignLeadId) {
    clQuery = clQuery.eq('id', campaignLeadId);
  }

  const { data: campaignLeads, error: clError } = await clQuery;

  if (clError) throw new AppError('Failed to fetch campaign leads.', 500);
  if (!campaignLeads || campaignLeads.length === 0) {
    throw new AppError('No pending leads found to generate templates for.', 404);
  }

  // 3. Process each lead — fetch enrichment data, call AI, save result
  const results = [];
  let processed = 0;
  let failed = 0;

  for (const cl of campaignLeads) {
    try {
      const lead = await fetchLeadData(cl.lead_data_id);
      if (!lead) {
        throw new Error(`leads_data row not found for id ${cl.lead_data_id}`);
      }

      const [linkedin, web] = await Promise.all([
        fetchLinkedinData(lead.linkedin),
        fetchWebData(lead.domain),
      ]);

      const generatedTemplate = await generateEmailForLead({ lead, linkedin, web, campaign });

      // Save template
      const { error: updateError } = await supabase
        .from('campaign_leads')
        .update({ mail_template: generatedTemplate })
        .eq('id', cl.id);

      if (updateError) throw new Error(`Supabase update failed: ${updateError.message}`);

      // FIX: Update status to 'template_generated' so this lead is not re-processed
      const { error: statusError } = await supabase
        .from('campaign_leads')
        .update({ status: 'template_generated' })
        .eq('id', cl.id);

      if (statusError) {
        logger.warn('Failed to update status to template_generated', {
          campaignLeadId: cl.id,
          error: statusError.message,
        });
      }

      results.push({
        campaignLeadId: cl.id,
        lead_data_id: cl.lead_data_id,
        leadName: lead.fullName || lead.email || cl.lead_data_id,
        status: 'template_generated',
        templatePreview:
          generatedTemplate.slice(0, 120) + (generatedTemplate.length > 120 ? '…' : ''),
      });

      processed++;
      logger.info('Mail template generated', {
        campaignLeadId: cl.id,
        lead_data_id: cl.lead_data_id,
      });
    } catch (err) {
      failed++;
      logger.error('Failed to generate template for lead', {
        campaignLeadId: cl.id,
        lead_data_id: cl.lead_data_id,
        error: err.message,
      });
      results.push({
        campaignLeadId: cl.id,
        lead_data_id: cl.lead_data_id,
        status: 'failed',
        error: err.message,
      });
    }
  }

  return { processed, failed, total: campaignLeads.length, results };
}

module.exports = { generateMailTemplates };
