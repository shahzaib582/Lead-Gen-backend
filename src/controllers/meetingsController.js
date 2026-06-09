const userService = require('../services/userService');
const meetingsService = require('../services/meetingsService');
const { toPublicMeeting } = require('../utils/meetingPublic');
const { successResponse, successResponsePaginated } = require('../utils/response');

async function list(req, res, next) {
  try {
    const { status, campaign_id: campaignId, from, to, page, limit } = req.query;
    const result = await meetingsService.listMeetings(req.user.id, {
      status,
      campaignId,
      from,
      to,
      page,
      limit,
    });

    return successResponsePaginated(
      res,
      200,
      'Meetings fetched successfully.',
      result.meetings.map(toPublicMeeting),
      {
        page: result.page,
        limit: result.limit,
        total: result.total,
      },
    );
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const row = await meetingsService.getMeetingForUser(req.user.id, req.params.id);
    return successResponse(res, 200, 'Meeting fetched successfully.', {
      meeting: toPublicMeeting(row),
    });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const userRow = await userService.findUserById(req.user.id);
    const row = await meetingsService.createMeeting(req.user.id, userRow, req.body);
    return successResponse(res, 201, 'Meeting created successfully.', {
      meeting: toPublicMeeting(row),
    });
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const userRow = await userService.findUserById(req.user.id);
    const row = await meetingsService.updateMeeting(
      req.user.id,
      userRow,
      req.params.id,
      req.body,
    );
    return successResponse(res, 200, 'Meeting updated successfully.', {
      meeting: toPublicMeeting(row),
    });
  } catch (err) {
    next(err);
  }
}

async function cancel(req, res, next) {
  try {
    const row = await meetingsService.cancelMeeting(req.user.id, req.params.id);
    return successResponse(res, 200, 'Meeting cancelled successfully.', {
      meeting: toPublicMeeting(row),
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, getOne, create, update, cancel };
