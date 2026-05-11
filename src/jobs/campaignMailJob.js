const campaignMailQueue = require('../queues/campaignMailQueue');

async function enqueueCampaignMailJob(
  { userId, campaignId, campaignLeadId },
  options = {}
) {
  return campaignMailQueue.add(
    'send-campaign-mail',
    {
      userId,
      campaignId,
      campaignLeadId,
    },
    {
      // Use a unique jobId so BullMQ never deduplicates/drops chained jobs.
      // The worker already guards against double-sends via lead.status === 'sent'.
      jobId: `mail-${campaignLeadId}-${Date.now()}`,
      ...options,
    }
  );
}

module.exports = {
  enqueueCampaignMailJob,
};