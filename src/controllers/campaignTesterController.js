const campaignTesterService = require('../services/campaignTesterService');
const { successResponse } = require('../utils/response');

async function createLead(req, res, next) {
  try {
    const { email, fullName, firstName, company, title } = req.body;

    const data = await campaignTesterService.createTesterLead({
      email,
      fullName,
      firstName,
      company,
      title,
    });

    return successResponse(res, 201, 'Tester lead created.', data);
  } catch (err) {
    next(err);
  }
}

async function runFollowUps(req, res, next) {
  try {
    const campaignId = req.params.id;
    const userId = req.user.id;
    const { ignoreWaitingDays = true, campaignLeadId = null, followUpId = null } = req.body || {};

    const result = await campaignTesterService.runTesterFollowUps({
      userId,
      campaignId,
      ignoreWaitingDays,
      campaignLeadId,
      followUpId,
    });

    return successResponse(res, 200, 'Tester follow-up run complete.', result);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createLead,
  runFollowUps,
};
