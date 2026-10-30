const { runLeadPipeline } = require('../services/leadPipelineService');
const { successResponse } = require('../utils/response');

async function run(req, res, next) {
  try {
    const data = await runLeadPipeline(req.user.id, req.body);
    return successResponse(res, 200, 'Lead pipeline complete.', data);
  } catch (err) {
    next(err);
  }
}

module.exports = { run };
