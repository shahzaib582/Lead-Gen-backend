const { validationResult } = require('express-validator');
const campaignLeadsService = require('../services/campaignLeadsService');
const AppError             = require('../utils/AppError');
const logger               = require('../utils/logger');

function handleValidationErrors(req) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const messages = errors.array().map((e) => e.msg).join(', ');
    throw new AppError(messages, 422);
  }
}

// ─── POST /campaigns/:id/leads ────────────────────────────────────────────────
// Add a single lead to a campaign.

async function addLead(req, res, next) {
  try {
    handleValidationErrors(req);

    const { lead_data_id, mail_template } = req.body;
    const campaignId = req.params.id;
    const userId     = req.user.id;

    const lead = await campaignLeadsService.addLeadToCampaign(userId, campaignId, {
      lead_data_id,
      mail_template,
    });

    logger.info('Lead added to campaign', { campaignId, lead_data_id, userId });

    return res.status(201).json({
      success: true,
      message: 'Lead added to campaign.',
      data: { lead },
    });
  } catch (err) {
    next(err);
  }
}

// ─── POST /campaigns/:id/leads/bulk ──────────────────────────────────────────
// Bulk-add leads to a campaign. Silently skips duplicates and reports them.

async function bulkAddLeads(req, res, next) {
  try {
    handleValidationErrors(req);

    const { leads }  = req.body;
    const campaignId = req.params.id;
    const userId     = req.user.id;

    const result = await campaignLeadsService.bulkAddLeadsToCampaign(userId, campaignId, leads);

    logger.info('Bulk leads added to campaign', {
      campaignId,
      userId,
      totalInserted:   result.totalInserted,
      totalDuplicates: result.totalDuplicates,
    });

    return res.status(201).json({
      success: true,
      message: `${result.totalInserted} lead(s) added. ${result.totalDuplicates} duplicate(s) skipped.`,
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /campaigns/:id/leads ─────────────────────────────────────────────────
// List all leads for a campaign with optional status filter and pagination.

async function listLeads(req, res, next) {
  try {
    handleValidationErrors(req);

    const campaignId = req.params.id;
    const userId     = req.user.id;
    const { status, page, limit } = req.query;

    const result = await campaignLeadsService.getCampaignLeads(userId, campaignId, {
      status,
      page:  parseInt(page  || '1',  10),
      limit: Math.min(parseInt(limit || '20', 10), 100),
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

// ─── PATCH /campaigns/:id/leads/:leadId ───────────────────────────────────────
// Update a campaign lead (status, sent_at, mail_template, error_message).

async function updateLead(req, res, next) {
  try {
    handleValidationErrors(req);

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

    return res.status(200).json({
      success: true,
      message: 'Campaign lead updated.',
      data: { lead },
    });
  } catch (err) {
    next(err);
  }
}

// ─── DELETE /campaigns/:id/leads/:leadId ──────────────────────────────────────
// Remove a lead from a campaign.

async function removeLead(req, res, next) {
  try {
    handleValidationErrors(req);

    const { id: campaignId, leadId } = req.params;
    const userId = req.user.id;

    await campaignLeadsService.removeCampaignLead(userId, campaignId, leadId);

    logger.info('Campaign lead removed', { campaignId, leadId, userId });

    return res.status(200).json({
      success: true,
      message: 'Lead removed from campaign.',
    });
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
    handleValidationErrors(req);

    const campaignId = req.params.id;
    const userId     = req.user.id;

    const result = await campaignLeadsService.assignRandomLeadsToCampaign(userId, campaignId);

    logger.info('Random leads assigned to campaign', {
      campaignId,
      userId,
      totalRequested:  result.totalRequested,
      totalAvailable:  result.totalAvailable,
      totalInserted:   result.totalInserted,
      totalDuplicates: result.totalDuplicates,
    });

    return res.status(201).json({
      success: true,
      message: `${result.totalInserted} lead(s) randomly assigned. ${result.totalDuplicates} duplicate(s) skipped.`,
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { addLead, bulkAddLeads, listLeads, updateLead, removeLead, assignRandomLeads };