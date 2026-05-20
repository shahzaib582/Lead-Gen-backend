const dashboardService = require('../services/dashboardService');
const { successResponse, successResponsePaginated } = require('../utils/response');

async function summary(req, res, next) {
  try {
    const data = await dashboardService.getDashboardSummary(req.user.id);
    return successResponse(res, 200, undefined, data);
  } catch (err) {
    next(err);
  }
}

async function performance(req, res, next) {
  try {
    const data = await dashboardService.getDashboardPerformance(req.user.id, {
      period: req.query.period,
      from: req.query.from,
      to: req.query.to,
    });
    return successResponse(res, 200, undefined, data);
  } catch (err) {
    next(err);
  }
}

async function activeCampaigns(req, res, next) {
  try {
    const result = await dashboardService.getDashboardActiveCampaigns(req.user.id, {
      page: parseInt(req.query.page || '1', 10),
      limit: parseInt(req.query.limit || '10', 10),
    });

    return successResponse(res, 200, undefined, {
      total_running: result.total_running,
      campaigns: result.campaigns,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: result.totalPages,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function recentActivity(req, res, next) {
  try {
    const result = await dashboardService.getDashboardRecentActivity(req.user.id, {
      page: parseInt(req.query.page || '1', 10),
      limit: parseInt(req.query.limit || '20', 10),
    });

    return successResponsePaginated(res, 200, undefined, result.activities, {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: result.totalPages,
    });
  } catch (err) {
    next(err);
  }
}

async function meetingStats(req, res, next) {
  try {
    const data = await dashboardService.getMeetingStats(req.user.id);
    return successResponse(res, 200, undefined, data);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  summary,
  performance,
  activeCampaigns,
  recentActivity,
  meetingStats,
};
