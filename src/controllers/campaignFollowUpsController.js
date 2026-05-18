const campaignFollowUpsService = require('../services/campaignFollowUpsService');
const { successResponse } = require('../utils/response');

async function list(req, res, next) {
  try {
    const campaignId = req.params.id;
    const userId = req.user.id;

    const followUps = await campaignFollowUpsService.listFollowUps(userId, campaignId);

    return successResponse(res, 200, undefined, { followUps });
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const { id: campaignId, followUpId } = req.params;
    const userId = req.user.id;

    const followUp = await campaignFollowUpsService.getFollowUpById(userId, campaignId, followUpId);

    return successResponse(res, 200, undefined, { followUp });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const campaignId = req.params.id;
    const userId = req.user.id;
    const { name, waiting_days, body_template } = req.body;

    const followUp = await campaignFollowUpsService.createFollowUp(userId, campaignId, {
      name,
      waiting_days,
      body_template,
    });

    return successResponse(res, 201, 'Follow-up created.', { followUp });
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const { id: campaignId, followUpId } = req.params;
    const userId = req.user.id;

    const allowed = ['name', 'waiting_days', 'body_template'];
    const updates = {};
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        updates[key] = req.body[key];
      }
    }

    const followUp = await campaignFollowUpsService.updateFollowUp(
      userId,
      campaignId,
      followUpId,
      updates
    );

    return successResponse(res, 200, 'Follow-up updated.', { followUp });
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const { id: campaignId, followUpId } = req.params;
    const userId = req.user.id;

    await campaignFollowUpsService.deleteFollowUp(userId, campaignId, followUpId);

    return successResponse(res, 200, 'Follow-up deleted.', undefined);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  list,
  getOne,
  create,
  update,
  remove,
};
