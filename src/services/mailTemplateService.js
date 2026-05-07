const OpenAI   = require('openai');
const supabase  = require('../config/supabase');
const AppError  = require('../utils/AppError');
const logger    = require('../utils/logger');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Fetch a single leads_data row by its bigint id.
 */
async function fetchLeadData(leadDataId) {
  const { data, error } = await supabase
    .from('leads_data')
    .select('*')
    .eq('id', Number(leadDataId))
    .single();

  if (error || !data) return null;
  return data;
}

/**
 * Fetch the matching linkedinscrapping row using leads_data.linkedin URL.
 * Returns null if the lead has no linkedin or no matching row exists.
 */
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

/**
 * Fetch the matching webscrapping row using leads_data.domain.
 * Returns null if the lead has no domain or no matching row exists.
 */
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

/**
 * Build the prompt from all available context.
 */
function buildPrompt({ lead, linkedin, web, campaignTemplate, campaignGoal, callToAction, exampleTraining }) {
  const sections = [];

  // ── Campaign context ──────────────────────────────────────────────────────
  sections.push(`## Campaign Context
Goal: ${campaignGoal || 'Not specified'}
Call to Action: ${callToAction || 'Not specified'}
${exampleTraining ? `Writing Style / Training Examples:\n${exampleTraining}` : ''}`);

  // ── User's template (the skeleton to personalise) ─────────────────────────
  if (campaignTemplate) {
    sections.push(`## Email Template to Personalise
Use this as the structural base — fill in every personalisation placeholder using the data below:

${campaignTemplate}`);
  }

  // ── Lead (leads_data) ─────────────────────────────────────────────────────
  const leadFields = [
    lead.fullName    && `Full Name: ${lead.fullName}`,
    lead.firstName   && `First Name: ${lead.firstName}`,
    lead.lastName    && `Last Name: ${lead.lastName}`,
    lead.title       && `Job Title: ${lead.title}`,
    lead.email       && `Email: ${lead.email}`,
    lead.company     && `Company: ${lead.company}`,
    lead.industry    && `Industry: ${lead.industry}`,
    lead.seniority   && `Seniority: ${lead.seniority}`,
    lead.department  && `Department: ${lead.department}`,
    lead.city        && `City: ${lead.city}`,
    lead.state       && `State: ${lead.state}`,
    lead.country     && `Country: ${lead.country}`,
    lead.employees   && `Company Size: ${lead.employees} employees`,
    lead.revenue     && `Revenue: ${lead.revenue}`,
    lead.fitTag      && `Fit Tag: ${lead.fitTag}`,
    lead.fitScore    && `Fit Score: ${lead.fitScore}`,
    lead.fitReason   && `Fit Reason: ${lead.fitReason}`,
    lead.notes       && `Notes: ${lead.notes}`,
  ].filter(Boolean);

  if (leadFields.length) {
    sections.push(`## Lead Information\n${leadFields.join('\n')}`);
  }

  // ── LinkedIn profile ──────────────────────────────────────────────────────
  if (linkedin) {
    const liFields = [
      linkedin.headline          && `Headline: ${linkedin.headline}`,
      linkedin.summary           && `Summary: ${linkedin.summary}`,
      linkedin.location          && `Location: ${linkedin.location}`,
      linkedin.follower_count    && `Followers: ${linkedin.follower_count}`,
      linkedin.connections_count && `Connections: ${linkedin.connections_count}`,
      linkedin.current_company   && `Current Company: ${linkedin.current_company}`,
    ].filter(Boolean);

    // Flatten experience array to plain text if present
    if (Array.isArray(linkedin.experience) && linkedin.experience.length) {
      const expText = linkedin.experience
        .slice(0, 3) // top 3 roles only — avoid prompt bloat
        .map((e) => `  • ${e.title || ''} at ${e.company || ''} (${e.duration || ''})`)
        .join('\n');
      liFields.push(`Recent Experience:\n${expText}`);
    }

    if (liFields.length) {
      sections.push(`## LinkedIn Profile\n${liFields.join('\n')}`);
    }
  }

  // ── Website / company intelligence ───────────────────────────────────────
  if (web && web.llmresponse) {
    sections.push(`## Company Website Intelligence\n${web.llmresponse}`);
  }

  // ── Final instruction ─────────────────────────────────────────────────────
  sections.push(`## Your Task
Write a personalised, human-sounding cold email for this specific lead.

Rules:
- Use ONLY the information provided above — do not invent facts.
- Replace every placeholder in the template (e.g. {{firstName}}, {{company}}) with the real values.
- Weave in 1–2 specific details from the LinkedIn profile or company intelligence to show genuine research.
- Keep it concise (under 200 words for the body).
- End with a clear, single call to action: "${callToAction || 'Reply to this email'}".
- Output ONLY the final email text (subject line first, then body). No explanation, no markdown fencing.
- Subject line format:  Subject: <your subject here>
- Then a blank line, then the email body.`);

  return sections.join('\n\n');
}

/**
 * Call OpenAI to generate a personalised email for one lead.
 * Returns the generated email string.
 */
async function generateEmailForLead({ lead, linkedin, web, campaign }) {
  const prompt = buildPrompt({
    lead,
    linkedin,
    web,
    campaignTemplate:  campaign.mail_template,
    campaignGoal:      campaign.goal,
    callToAction:      campaign.call_to_action,
    exampleTraining:   campaign.example_training,
  });

  const response = await openai.chat.completions.create({
    model:      'gpt-4o',
    max_tokens: 1024,
    messages:   [{ role: 'user', content: prompt }],
  });

  return response.choices[0].message.content.trim();
}

// ─── Main exported function ───────────────────────────────────────────────────

/**
 * Generate personalised mail templates for all `pending` campaign leads
 * (or a specific one if campaignLeadId is provided), then save them back
 * to campaign_leads.mail_template in Supabase.
 *
 * @param {string} userId
 * @param {string} campaignId
 * @param {string|null} campaignLeadId  — if provided, only process that one lead
 * @returns {{ processed: number, failed: number, results: object[] }}
 */
async function generateMailTemplates(userId, campaignId, campaignLeadId = null) {
  
  // 1. Fetch campaign (with ownership check)
  const { data: campaign, error: campError } = await supabase
    .from('campaigns')
    .select('id, goal, call_to_action, mail_template, example_training')
    .eq('id', campaignId)
    .eq('user_id', userId)
    .single();

  if (campError || !campaign) throw new AppError('Campaign not found.', 404);

  // 2. Fetch the campaign_leads to process
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
  const results  = [];
  let processed  = 0;
  let failed     = 0;

  for (const cl of campaignLeads) {
    try {
      // Fetch leads_data row
      const lead = await fetchLeadData(cl.lead_data_id);
      if (!lead) {
        throw new Error(`leads_data row not found for id ${cl.lead_data_id}`);
      }

      // Fetch enrichment in parallel
      const [linkedin, web] = await Promise.all([
        fetchLinkedinData(lead.linkedin),
        fetchWebData(lead.domain),
      ]);

      // Generate personalised email via OpenAI
      const generatedTemplate = await generateEmailForLead({ lead, linkedin, web, campaign });

      // Save back to campaign_leads.mail_template
      const { error: updateError } = await supabase
        .from('campaign_leads')
        .update({ mail_template: generatedTemplate })
        .eq('id', cl.id);

      if (updateError) throw new Error(`Supabase update failed: ${updateError.message}`);

      results.push({
        campaignLeadId: cl.id,
        lead_data_id:   cl.lead_data_id,
        leadName:       lead.fullName || lead.email || cl.lead_data_id,
        status:         'generated',
        templatePreview: generatedTemplate.slice(0, 120) + (generatedTemplate.length > 120 ? '…' : ''),
      });

      processed++;
      logger.info('Mail template generated', { campaignLeadId: cl.id, lead_data_id: cl.lead_data_id });

    } catch (err) {
      failed++;
      logger.error('Failed to generate template for lead', {
        campaignLeadId: cl.id,
        lead_data_id:   cl.lead_data_id,
        error:          err.message,
      });
      results.push({
        campaignLeadId: cl.id,
        lead_data_id:   cl.lead_data_id,
        status:         'failed',
        error:          err.message,
      });
    }
  }

  return { processed, failed, total: campaignLeads.length, results };
}

module.exports = { generateMailTemplates };