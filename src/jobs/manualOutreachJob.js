const queue = require('../queues/campaignMailQueue');

async function enqueueManualOutreach({ userId, campaignId }) {
  const jobId = `manual-${campaignId}`;
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (['waiting', 'active', 'delayed', 'prioritized'].includes(state)) {
      return { jobId, alreadyQueued: true };
    }
    await existing.remove();
  }
  await queue.add('manual-outreach', { userId, campaignId }, { jobId });
  return { jobId, alreadyQueued: false };
}
module.exports = { enqueueManualOutreach };
