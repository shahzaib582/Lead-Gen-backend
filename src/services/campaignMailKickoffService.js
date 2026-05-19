const supabase = require('../config/supabase');
const campaignMailQueue = require('../queues/campaignMailQueue');
const { enqueueCampaignMailJob } = require('../jobs/campaignMailJob');
const { isCampaignActiveForSend } = require('./campaignSendRules');
const logger = require('../utils/logger');

/**
 * Start the sequential mail worker chain when a lead has a template and no mail job is running.
 * Safe to call multiple times — only the first call enqueues while the chain is idle.
 */
async function maybeKickoffCampaignMailChain({ userId, campaignId, campaignLeadId }) {
  const { data: campaign, error: campErr } = await supabase
    .from('campaigns')
    .select('id, status')
    .eq('id', campaignId)
    .eq('user_id', userId)
    .single();

  if (campErr || !campaign) {
    return { started: false, reason: 'campaign_not_found' };
  }

  if (!isCampaignActiveForSend(campaign)) {
    logger.info('[MailKickoff] Skipped — campaign not active', {
      campaignId,
      status: campaign.status,
      campaignLeadId,
    });
    return { started: false, reason: 'campaign_not_active', status: campaign.status };
  }

  const { data: lead, error: leadErr } = await supabase
    .from('campaign_leads')
    .select('id, status, mail_template')
    .eq('id', campaignLeadId)
    .eq('campaign_id', campaignId)
    .eq('user_id', userId)
    .maybeSingle();

  if (leadErr || !lead) {
    return { started: false, reason: 'lead_not_found' };
  }

  if (lead.status === 'sent') {
    return { started: false, reason: 'already_sent' };
  }

  if (lead.status !== 'template_generated' || !lead.mail_template?.trim()) {
    return { started: false, reason: 'not_ready_to_send', status: lead.status };
  }

  const counts = await campaignMailQueue.getJobCounts('waiting', 'delayed', 'active');
  const activeChain = counts.waiting + counts.delayed + counts.active;

  if (activeChain > 0) {
    return { started: false, reason: 'mail_chain_already_running', activeChain };
  }

  await enqueueCampaignMailJob({ userId, campaignId, campaignLeadId }, { delay: 0 });
  logger.info('[MailKickoff] Mail chain started', { campaignId, campaignLeadId });

  return { started: true };
}

module.exports = { maybeKickoffCampaignMailChain };
