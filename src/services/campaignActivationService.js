const supabase = require('../config/supabase');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { enqueueMailTemplateJob } = require('../jobs/mailTemplateJob');
const mailTemplateQueue = require('../queues/mailTemplateQueue');
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
    .select('id, status')
    .eq('id', campaignId)
    .eq('user_id', userId)
    .single();

  if (cErr || !campaign) throw new AppError('Campaign not found.', 404);

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

    const jobId = `template-${lead.id}`;
    try {
      const existing = await mailTemplateQueue.getJob(jobId);
      if (existing) {
        const state = await existing.getState();
        if (['waiting', 'delayed', 'active', 'prioritized'].includes(state)) {
          skippedDuplicate += 1;
          continue;
        }
      }
    } catch {
      // getJob failed — fall through to enqueue
    }

    try {
      await enqueueMailTemplateJob({
        userId,
        campaignId,
        campaignLeadId: lead.id,
      });
      enqueued += 1;
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      if (/already exists|duplicate job id|Job id already exists/i.test(msg)) {
        skippedDuplicate += 1;
      } else {
        logger.warn('[Activation] enqueue template job failed', {
          campaignId,
          campaignLeadId: lead.id,
          error: msg,
        });
      }
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
