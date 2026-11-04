const { getCampaignById } = require('../services/campaignService');
const queue = require('../queues/campaignMailQueue');
const { successResponse } = require('../utils/response');

async function getRunStatus(req, res, next) {
  try {
    await getCampaignById(req.user.id, req.params.id);
    const job = await queue.getJob(`manual-${req.params.id}`);
    if (!job || job.data.userId !== req.user.id) {
      return successResponse(res, 200, undefined, { job: null });
    }
    const result = job.returnvalue;
    return successResponse(res, 200, undefined, {
      job: {
        id: job.id,
        state: await job.getState(),
        attemptsMade: job.attemptsMade,
        result: result
          ? { sent: result.sent, failed: result.sendFailed, skipped: result.sendSkipped }
          : null,
        error: job.failedReason ? String(job.failedReason).slice(0, 300) : null,
      },
    });
  } catch (err) {
    next(err);
  }
}
module.exports = { getRunStatus };
