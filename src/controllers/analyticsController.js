const analyticsService = require('../services/analyticsService');
const { scheduleReplySyncForUser } = require('../services/gmailReplyDetectionService');
const { successResponse } = require('../utils/response');

async function overview(req, res, next) {
  try {
    scheduleReplySyncForUser(req.user.id);
    const data = await analyticsService.getAnalyticsOverview(req.user.id, {
      period: req.query.period,
      from: req.query.from,
      to: req.query.to,
    });
    return successResponse(res, 200, undefined, data);
  } catch (err) {
    next(err);
  }
}

async function campaignChart(req, res, next) {
  try {
    const data = await analyticsService.getAnalyticsCampaignChart(req.user.id, {
      period: req.query.period,
      from: req.query.from,
      to: req.query.to,
    });
    return successResponse(res, 200, undefined, data);
  } catch (err) {
    next(err);
  }
}

async function campaignComparison(req, res, next) {
  try {
    const data = await analyticsService.getAnalyticsCampaignComparison(req.user.id, {
      page: parseInt(req.query.page || '1', 10),
      limit: parseInt(req.query.limit || '10', 10),
    });
    return successResponse(res, 200, undefined, data);
  } catch (err) {
    next(err);
  }
}

async function sentVsReplies(req, res, next) {
  try {
    const weeks = req.query.weeks ? parseInt(req.query.weeks, 10) : 4;
    const data = await analyticsService.getAnalyticsSentVsReplies(req.user.id, { weeks });
    return successResponse(res, 200, undefined, data);
  } catch (err) {
    next(err);
  }
}

async function replyBreakdown(req, res, next) {
  try {
    const data = await analyticsService.getAnalyticsReplyBreakdown(req.user.id, {
      period: req.query.period,
      from: req.query.from,
      to: req.query.to,
    });
    return successResponse(res, 200, undefined, data);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  overview,
  campaignChart,
  campaignComparison,
  sentVsReplies,
  replyBreakdown,
};
