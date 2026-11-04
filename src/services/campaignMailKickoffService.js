const supabase = require('../config/supabase');
const campaignMailQueue = require('../queues/campaignMailQueue');
const connection = require('../queues/connection');
const { randomUUID } = require('crypto');
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
    .select('id, status, run_mode')
    .eq('id', campaignId)
    .eq('user_id', userId)
    .single();

  if (campErr || !campaign) {
    return { started: false, reason: 'campaign_not_found' };
  }

  if (campaign.run_mode !== 'auto') {
    return { started: false, reason: 'manual_run_mode' };
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

  const lockKey = `mail-kickoff:${campaignId}`;
  const owner = randomUUID();
  if (!(await connection.set(lockKey, owner, 'PX', 30000, 'NX'))) {
    return { started: false, reason: 'mail_chain_already_running' };
  }
  try {
    const jobs = await campaignMailQueue.getJobs(['waiting', 'delayed', 'active', 'prioritized']);
    if (jobs.some((job) => job.data.campaignId === campaignId)) {
      return { started: false, reason: 'mail_chain_already_running' };
    }
    await enqueueCampaignMailJob({ userId, campaignId, campaignLeadId }, { delay: 0 });
    logger.info('[MailKickoff] Mail chain started', { campaignId, campaignLeadId });
  } finally {
    await connection.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      lockKey,
      owner
    );
  }

  return { started: true };
}

module.exports = { maybeKickoffCampaignMailChain };
