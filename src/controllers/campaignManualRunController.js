const { validateManualCampaignRunStart } = require('../services/campaignManualRunService');
const { enqueueManualOutreach } = require('../jobs/manualOutreachJob');
const { successResponse } = require('../utils/response');

async function runOutreach(req, res, next) {
  try {
    const campaignId = req.params.id;
    const userId = req.user.id;
    const { progress } = await validateManualCampaignRunStart(userId, campaignId);
    const queued = await enqueueManualOutreach({ userId, campaignId });
    return successResponse(res, 202, progress.userMessage || 'Campaign outreach queued.', {
      campaignId,
      status: 'processing',
      ...progress,
      ...queued,
    });
  } catch (err) {
    next(err);
  }
}
module.exports = { runOutreach };
