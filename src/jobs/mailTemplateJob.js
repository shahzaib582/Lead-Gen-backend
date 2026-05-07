const mailTemplateQueue = require(
  '../queues/mailTemplateQueue'
);

async function enqueueMailTemplateJob({
  userId,
  campaignId,
  campaignLeadId,
}) {
  return mailTemplateQueue.add(
    'generate-template',
    {
      userId,
      campaignId,
      campaignLeadId,
    },
    {
      jobId: `template-${campaignLeadId}`,
    }
  );
}

module.exports = {
  enqueueMailTemplateJob,
};