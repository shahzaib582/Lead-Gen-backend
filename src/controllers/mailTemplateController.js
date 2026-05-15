const mailTemplateService = require('../services/mailTemplateService');
const logger = require('../utils/logger');
const { successResponse } = require('../utils/response');

// ─── POST /campaigns/:id/leads/generate-templates ────────────────────────────
// Generates a personalised mail_template for every pending lead in the campaign
// by combining leads_data + linkedinscrapping + webscrapping + the campaign's
// own mail_template/example_training via Claude AI, then saves the result back
// to campaign_leads.mail_template.
//
// Optional body param:
//   campaign_lead_id  — if provided, only generate for that single lead

async function generateTemplates(req, res, next) {
  try {
    const campaignId = req.params.id;
    const userId = req.user.id;
    const campaignLeadId = req.body.campaign_lead_id || null;

    logger.info('Starting mail template generation', { campaignId, userId, campaignLeadId });

    const result = await mailTemplateService.generateMailTemplates(
      userId,
      campaignId,
      campaignLeadId
    );

    logger.info('Mail template generation complete', {
      campaignId,
      userId,
      processed: result.processed,
      failed: result.failed,
    });

    return successResponse(
      res,
      200,
      `${result.processed} template(s) generated. ${result.failed} failed.`,
      result
    );
  } catch (err) {
    next(err);
  }
}

module.exports = { generateTemplates };
