const {
  validateManualCampaignRunStart,
  runManualCampaignOutreach,
} = require('../services/campaignManualRunService');
const logger = require('../utils/logger');
const { successResponse } = require('../utils/response');

// POST /api/campaigns/:id/leads/run — manual active campaigns only (async; returns immediately)

async function runOutreach(req, res, next) {
  try {
    const campaignId = req.params.id;
    const userId = req.user.id;

    const { leadCount } = await validateManualCampaignRunStart(userId, campaignId);

    void runManualCampaignOutreach(userId, campaignId)
      .then((result) => {
        logger.info('[ManualRun] Background outreach finished', {
          campaignId,
          userId,
          sent: result.sent,
          templatesGenerated: result.templatesGenerated,
          templateFailures: result.templateFailures,
          sendFailed: result.sendFailed,
          dailyLimitReached: result.dailyLimitReached,
        });
      })
      .catch((err) => {
        logger.error('[ManualRun] Background outreach failed', {
          campaignId,
          userId,
          error: err.message,
          code: err.code,
        });
      });

    return successResponse(res, 202, 'Campaign outreach started.', {
      campaignId,
      status: 'processing',
      leadsQueued: leadCount,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { runOutreach };
