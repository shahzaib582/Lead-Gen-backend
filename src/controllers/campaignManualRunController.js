const { runManualCampaignOutreach } = require('../services/campaignManualRunService');
const { successResponse } = require('../utils/response');

// POST /api/campaigns/:id/leads/run — manual active campaigns only

async function runOutreach(req, res, next) {
  try {
    const campaignId = req.params.id;
    const userId = req.user.id;

    const result = await runManualCampaignOutreach(userId, campaignId);

    const message = `${result.sent} email(s) sent, ${result.templatesGenerated} template(s) generated, ${result.templateFailures} template failure(s), ${result.sendFailed} send failure(s).`;

    return successResponse(res, 200, message, result);
  } catch (err) {
    next(err);
  }
}

module.exports = { runOutreach };
