const campaignMailQueue = require(
  '../queues/campaignMailQueue'
);

async function enqueueCampaignMailJob({
  userId,
  campaignId,
  campaignLeadId,
}) {
  return campaignMailQueue.add(
    'send-campaign-mail',
    {
      userId,
      campaignId,
      campaignLeadId,
    },
    {
      jobId: `mail-${campaignLeadId}`,
    }
  );
}

module.exports = {
  enqueueCampaignMailJob,
};