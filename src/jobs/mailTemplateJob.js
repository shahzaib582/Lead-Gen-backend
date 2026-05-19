const mailTemplateQueue = require('../queues/mailTemplateQueue');

const QUEUED_STATES = new Set(['waiting', 'delayed', 'active', 'prioritized']);

function templateJobId(campaignLeadId) {
  return `template-${campaignLeadId}`;
}

/**
 * Enqueue template generation. Removes a finished job with the same id so leads can be re-processed
 * (e.g. previous job completed but lead is still pending after a worker crash).
 */
async function ensureMailTemplateJob({ userId, campaignId, campaignLeadId }) {
  const jobId = templateJobId(campaignLeadId);

  try {
    const existing = await mailTemplateQueue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (QUEUED_STATES.has(state)) {
        return { queued: false, reason: 'already_queued', state };
      }
      await existing.remove();
    }
  } catch {
    // getJob/remove failed — attempt add anyway
  }

  await mailTemplateQueue.add(
    'generate-template',
    { userId, campaignId, campaignLeadId },
    { jobId }
  );

  return { queued: true };
}

/** @deprecated Use ensureMailTemplateJob */
async function enqueueMailTemplateJob(params) {
  return ensureMailTemplateJob(params);
}

module.exports = {
  ensureMailTemplateJob,
  enqueueMailTemplateJob,
  templateJobId,
};
