const campaignMailQueue = require(
  '../queues/campaignMailQueue'
);

async function enqueueCampaignMailJob(
  { userId, campaignId, campaignLeadId },
  options = {}   // ← FIX: accept options (e.g. delay) from caller
) {
  return campaignMailQueue.add(
    'send-campaign-mail',
    {
      userId,
      campaignId,
      campaignLeadId,
    },
    {
      jobId: `mail-${campaignLeadId}`,
      ...options,  // ← FIX: spread delay and any other options in
    }
  );
}

module.exports = {
  enqueueCampaignMailJob,
};