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

    const { leadCount, progress } = await validateManualCampaignRunStart(userId, campaignId);

    void runManualCampaignOutreach(userId, campaignId)
      .then(async (result) => {
        logger.info('[ManualRun] Background outreach finished', {
          campaignId,
          userId,
          sent: result.sent,
          templatesGenerated: result.templatesGenerated,
          templateFailures: result.templateFailures,
          sendFailed: result.sendFailed,
          dailyLimitReached: result.dailyLimitReached,
        });
        const { notifyOutreachFinished } = require('../services/notificationService');
        await notifyOutreachFinished(userId, campaignId, result);
      })
      .catch(async (err) => {
        logger.error('[ManualRun] Background outreach failed', {
          campaignId,
          userId,
          error: err.message,
          code: err.code,
        });
        const { publishCampaignEvent } = require('../services/campaignEventsPublisher');
        await publishCampaignEvent(campaignId, {
          type: 'outreach_failed',
          userId,
          message: err.message,
          code: err.code || null,
        }).catch(() => {});
      });

    const message = progress.userMessage || 'Campaign outreach started.';
    return successResponse(res, 202, message, {
      campaignId,
      status: 'processing',
      ...progress,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { runOutreach };
