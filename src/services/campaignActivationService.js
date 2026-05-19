const supabase = require('../config/supabase');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { ensureMailTemplateJob } = require('../jobs/mailTemplateJob');
const { publishCampaignEvent, getCampaignProgressSnapshot } = require('./campaignEventsPublisher');
const { needsTemplateJob } = require('./campaignActivationRules');

/**
 * Enqueue template generation for campaign leads that are pending with no usable template.
 * BullMQ jobId `template-${campaignLeadId}` dedupes concurrent adds.
 *
 * @returns {{ enqueued: number, skippedDuplicate: number, skippedWrongState: number, examined: number }}
 */
async function enqueuePendingTemplateJobsForCampaign(userId, campaignId, { previousStatus } = {}) {
  if (previousStatus === 'active') {
    return { enqueued: 0, skippedDuplicate: 0, skippedWrongState: 0, examined: 0, note: 'already_active' };
  }

  const { data: campaign, error: cErr } = await supabase
    .from('campaigns')
    .select('id, status, run_mode')
    .eq('id', campaignId)
    .eq('user_id', userId)
    .single();

  if (cErr || !campaign) throw new AppError('Campaign not found.', 404);

  if (campaign.run_mode !== 'auto') {
    return {
      enqueued: 0,
      skippedDuplicate: 0,
      skippedWrongState: 0,
      examined: 0,
      note: 'manual_run_mode',
    };
  }

  const { data: rows, error: lErr } = await supabase
    .from('campaign_leads')
    .select('id, status, mail_template')
    .eq('campaign_id', campaignId)
    .eq('user_id', userId);

  if (lErr) throw new AppError('Failed to load campaign leads.', 500);

  let enqueued = 0;
  let skippedDuplicate = 0;
  let skippedWrongState = 0;
  let examined = 0;

  for (const lead of rows || []) {
    examined += 1;
    if (!needsTemplateJob(lead)) {
      skippedWrongState += 1;
      continue;
    }

    try {
      const result = await ensureMailTemplateJob({
        userId,
        campaignId,
        campaignLeadId: lead.id,
      });
      if (result.queued) {
        enqueued += 1;
      } else if (result.reason === 'already_queued') {
        skippedDuplicate += 1;
      } else {
        skippedDuplicate += 1;
      }
    } catch (err) {
      logger.warn('[Activation] enqueue template job failed', {
        campaignId,
        campaignLeadId: lead.id,
        error: err.message,
      });
    }
  }

  await publishCampaignEvent(campaignId, {
    type: 'campaign_progress',
    campaignId,
    pendingTemplateEnqueued: enqueued,
    examined,
    ...(await getCampaignProgressSnapshot(userId, campaignId)),
  });

  return { enqueued, skippedDuplicate, skippedWrongState, examined };
}

module.exports = {
  enqueuePendingTemplateJobsForCampaign,
  needsTemplateJob,
};
