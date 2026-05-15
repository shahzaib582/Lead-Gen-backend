const campaignLeadsService = require('../services/campaignLeadsService');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { successResponse, successResponsePaginated } = require('../utils/response');

// ─── POST /campaigns/:id/leads ────────────────────────────────────────────────
// Add a single lead to a campaign.

async function addLead(req, res, next) {
  try {
    const { lead_data_id, mail_template } = req.body;
    const campaignId = req.params.id;
    const userId = req.user.id;

    const lead = await campaignLeadsService.addLeadToCampaign(userId, campaignId, {
      lead_data_id,
      mail_template,
    });

    logger.info('Lead added to campaign', { campaignId, lead_data_id, userId });

    return successResponse(res, 201, 'Lead added to campaign.', { lead });
  } catch (err) {
    next(err);
  }
}

// ─── POST /campaigns/:id/leads/bulk ──────────────────────────────────────────
// Bulk-add leads to a campaign. Silently skips duplicates and reports them.

async function bulkAddLeads(req, res, next) {
  try {
    const { leads } = req.body;
    const campaignId = req.params.id;
    const userId = req.user.id;

    const result = await campaignLeadsService.bulkAddLeadsToCampaign(userId, campaignId, leads);

    logger.info('Bulk leads added to campaign', {
      campaignId,
      userId,
      totalInserted: result.totalInserted,
      totalDuplicates: result.totalDuplicates,
    });

    return successResponse(
      res,
      201,
      `${result.totalInserted} lead(s) added. ${result.totalDuplicates} duplicate(s) skipped.`,
      result
    );
  } catch (err) {
    next(err);
  }
}

// ─── GET /campaigns/:id/leads ─────────────────────────────────────────────────
// List all leads for a campaign with optional status filter and pagination.

async function listLeads(req, res, next) {
  try {
    const campaignId = req.params.id;
    const userId = req.user.id;
    const { status, page, limit } = req.query;

    const result = await campaignLeadsService.getCampaignLeads(userId, campaignId, {
      status,
      page: parseInt(page || '1', 10),
      limit: Math.min(parseInt(limit || '20', 10), 100),
    });

    return successResponsePaginated(res, 200, undefined, result.leads, {
      page: result.page,
      limit: result.limit,
      total: result.total ?? 0,
      totalPages: result.totalPages,
    });
  } catch (err) {
    next(err);
  }
}

// ─── PATCH /campaigns/:id/leads/:leadId ───────────────────────────────────────
// Update a campaign lead (status, sent_at, mail_template, error_message).

async function updateLead(req, res, next) {
  try {
    const { id: campaignId, leadId } = req.params;
    const userId = req.user.id;

    const ALLOWED = ['status', 'sent_at', 'mail_template', 'error_message'];
    const updates = {};
    for (const key of ALLOWED) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        updates[key] = req.body[key];
      }
    }

    if (Object.keys(updates).length === 0) {
      throw new AppError('No valid fields provided for update.', 400);
    }

    const lead = await campaignLeadsService.updateCampaignLead(userId, campaignId, leadId, updates);

    logger.info('Campaign lead updated', { campaignId, leadId, userId, updates });

    return successResponse(res, 200, 'Campaign lead updated.', { lead });
  } catch (err) {
    next(err);
  }
}

// ─── DELETE /campaigns/:id/leads/:leadId ──────────────────────────────────────
// Remove a lead from a campaign.

async function removeLead(req, res, next) {
  try {
    const { id: campaignId, leadId } = req.params;
    const userId = req.user.id;

    await campaignLeadsService.removeCampaignLead(userId, campaignId, leadId);

    logger.info('Campaign lead removed', { campaignId, leadId, userId });

    return successResponse(res, 200, 'Lead removed from campaign.', undefined);
  } catch (err) {
    next(err);
  }
}

// ─── POST /campaigns/:id/leads/assign-random ─────────────────────────────────
// Reads target_leads from the campaign, picks that many random rows from
// leads_data (skipping already-assigned ones), and inserts them into
// campaign_leads.

async function assignRandomLeads(req, res, next) {
  try {
    const campaignId = req.params.id;
    const userId = req.user.id;

    const result = await campaignLeadsService.assignRandomLeadsToCampaign(userId, campaignId);

    logger.info('Random leads assigned to campaign', {
      campaignId,
      userId,
      totalRequested: result.totalRequested,
      totalAvailable: result.totalAvailable,
      totalInserted: result.totalInserted,
      totalDuplicates: result.totalDuplicates,
    });

    return successResponse(
      res,
      201,
      `${result.totalInserted} lead(s) randomly assigned. ${result.totalDuplicates} duplicate(s) skipped.`,
      result
    );
  } catch (err) {
    next(err);
  }
}

// ─── POST /campaigns/:id/leads/assign-filtered ────────────────────────────────
// Picks leads filtered by country and/or industry and assigns them to a campaign.

async function assignFilteredLeads(req, res, next) {
  try {
    const campaignId = req.params.id;
    const userId = req.user.id;
    const { country, industry, limit } = req.body;

    const result = await campaignLeadsService.assignFilteredLeadsToCampaign(userId, campaignId, {
      country,
      industry,
      limit,
    });

    logger.info('Filtered leads assigned to campaign', {
      campaignId,
      userId,
      filters: result.filters,
      totalInserted: result.totalInserted,
      totalDuplicates: result.totalDuplicates,
    });

    return successResponse(
      res,
      201,
      `${result.totalInserted} lead(s) assigned. ${result.totalDuplicates} duplicate(s) skipped.`,
      result
    );
  } catch (err) {
    next(err);
  }
}

module.exports = {
  addLead,
  bulkAddLeads,
  listLeads,
  updateLead,
  removeLead,
  assignRandomLeads,
  assignFilteredLeads,
};
