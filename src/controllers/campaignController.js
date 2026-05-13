const { validationResult } = require('express-validator');
const campaignService = require('../services/campaignService');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

function handleValidationErrors(req) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const messages = errors
      .array()
      .map((e) => e.msg)
      .join(', ');
    throw new AppError(messages, 422);
  }
}

// ─── POST /campaigns ──────────────────────────────────────────────────────────

async function create(req, res, next) {
  try {
    handleValidationErrors(req);

    const {
      name,
      goal,
      target_zone,
      call_to_action,
      run_mode,
      mail_template,
      example_training,
      target_leads,
      lead_source,
      status,
    } = req.body;

    const campaign = await campaignService.createCampaign(req.user.id, {
      name,
      goal,
      target_zone,
      call_to_action,
      run_mode,
      mail_template: mail_template || null,
      example_training: example_training || null,
      target_leads: target_leads || 0,
      lead_source: lead_source || 'both',
      status: status || 'draft',
    });

    logger.info('Campaign created', { campaignId: campaign.id, userId: req.user.id });

    return res.status(201).json({
      success: true,
      message: 'Campaign created successfully.',
      data: { campaign },
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /campaigns ───────────────────────────────────────────────────────────

async function list(req, res, next) {
  try {
    const { status, page, limit } = req.query;
    const result = await campaignService.getCampaigns(req.user.id, {
      status,
      page: parseInt(page || '1', 10),
      limit: parseInt(limit || '20', 10),
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /campaigns/:id ───────────────────────────────────────────────────────

async function getOne(req, res, next) {
  try {
    const campaign = await campaignService.getCampaignById(req.user.id, req.params.id);

    return res.status(200).json({
      success: true,
      data: { campaign },
    });
  } catch (err) {
    next(err);
  }
}

// ─── PATCH /campaigns/:id ─────────────────────────────────────────────────────

async function update(req, res, next) {
  try {
    handleValidationErrors(req);

    const allowed = [
      'name',
      'goal',
      'target_zone',
      'call_to_action',
      'run_mode',
      'mail_template',
      'example_training',
      'target_leads',
      'lead_source',
      'status',
    ];

    // Only include fields the client actually sent
    const updates = {};
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        updates[key] = req.body[key];
      }
    }

    if (Object.keys(updates).length === 0) {
      throw new AppError('No valid fields provided for update.', 400);
    }

    const campaign = await campaignService.updateCampaign(req.user.id, req.params.id, updates);

    logger.info('Campaign updated', { campaignId: campaign.id, userId: req.user.id });

    return res.status(200).json({
      success: true,
      message: 'Campaign updated successfully.',
      data: { campaign },
    });
  } catch (err) {
    next(err);
  }
}

// ─── DELETE /campaigns/:id ────────────────────────────────────────────────────

async function remove(req, res, next) {
  try {
    await campaignService.deleteCampaign(req.user.id, req.params.id);

    logger.info('Campaign deleted', { campaignId: req.params.id, userId: req.user.id });

    return res.status(200).json({
      success: true,
      message: 'Campaign deleted successfully.',
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { create, list, getOne, update, remove };
