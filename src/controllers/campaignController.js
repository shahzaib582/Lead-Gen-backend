const campaignService = require('../services/campaignService');
const campaignLeadsService = require('../services/campaignLeadsService');
const { enqueuePendingTemplateJobsForCampaign } = require('../services/campaignActivationService');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { successResponse, successResponsePaginated } = require('../utils/response');

// ─── POST /campaigns ──────────────────────────────────────────────────────────

async function create(req, res, next) {
  try {
    const {
      name,
      goal,
      target_zone,
      call_to_action,
      run_mode,
      target_tone,
      mail_training_instruction,
      mail_template_samples,
      target_leads,
      lead_source,
      status,
      sender_display_name,
      sender_address,
      sender_phone,
    } = req.body;

    const initialStatus = status || 'draft';
    const campaign = await campaignService.createCampaign(req.user.id, {
      name,
      goal,
      target_zone,
      call_to_action,
      run_mode,
      target_tone: target_tone ?? 'Professional',
      mail_training_instruction: mail_training_instruction ?? null,
      mail_template_samples: mail_template_samples ?? [],
      target_leads: target_leads || 0,
      lead_source: lead_source || 'both',
      status: initialStatus,
      sender_display_name: sender_display_name || null,
      sender_address: sender_address || null,
      sender_phone: sender_phone || null,
    });

    logger.info('Campaign created', { campaignId: campaign.id, userId: req.user.id });

    let autoAssignSummary = null;
    const autoAssign =
      process.env.CAMPAIGN_ACTIVE_CREATE_AUTO_ASSIGN === '1' ||
      process.env.CAMPAIGN_ACTIVE_CREATE_AUTO_ASSIGN === 'true';
    if (autoAssign && initialStatus === 'active' && (target_leads || 0) > 0) {
      try {
        autoAssignSummary = await campaignLeadsService.assignRandomLeadsToCampaign(
          req.user.id,
          campaign.id
        );
        logger.info('Campaign create auto-assign (CAMPAIGN_ACTIVE_CREATE_AUTO_ASSIGN)', {
          campaignId: campaign.id,
          ...autoAssignSummary,
        });
      } catch (err) {
        logger.warn('Campaign create auto-assign failed', {
          campaignId: campaign.id,
          error: err.message,
        });
        autoAssignSummary = { error: err.message };
      }
    }

    return successResponse(res, 201, 'Campaign created successfully.', {
      campaign,
      ...(autoAssignSummary ? { autoAssign: autoAssignSummary } : {}),
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

    return successResponsePaginated(res, 200, undefined, result.campaigns, {
      page: result.page,
      limit: result.limit,
      total: result.total ?? 0,
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /campaigns/:id ───────────────────────────────────────────────────────

async function getOne(req, res, next) {
  try {
    const campaign = await campaignService.getCampaignById(req.user.id, req.params.id);

    return successResponse(res, 200, undefined, { campaign });
  } catch (err) {
    next(err);
  }
}

// ─── PATCH /campaigns/:id ─────────────────────────────────────────────────────

async function update(req, res, next) {
  try {
    const allowed = [
      'name',
      'goal',
      'target_zone',
      'call_to_action',
      'run_mode',
      'target_tone',
      'mail_training_instruction',
      'mail_template_samples',
      'target_leads',
      'lead_source',
      'status',
      'sender_display_name',
      'sender_address',
      'sender_phone',
    ];

    // Only include fields the client actually sent
    const updates = {};
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        let v = req.body[key];
        if (key === 'mail_template_samples' && v === null) {
          v = [];
        }
        updates[key] = v;
      }
    }

    if (Object.keys(updates).length === 0) {
      throw new AppError('No valid fields provided for update.', 400);
    }

    const previous = await campaignService.getCampaignById(req.user.id, req.params.id);

    const campaign = await campaignService.updateCampaign(req.user.id, req.params.id, updates);

    let activationSummary = null;
    if (Object.prototype.hasOwnProperty.call(updates, 'status') && updates.status === 'active') {
      if (previous.status !== 'active') {
        activationSummary = await enqueuePendingTemplateJobsForCampaign(req.user.id, campaign.id, {
          previousStatus: previous.status,
        });
      }
    }

    logger.info('Campaign updated', {
      campaignId: campaign.id,
      userId: req.user.id,
      ...(activationSummary ? { activationSummary } : {}),
    });

    return successResponse(res, 200, 'Campaign updated successfully.', {
      campaign,
      ...(activationSummary ? { activation: activationSummary } : {}),
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

    return successResponse(res, 200, 'Campaign deleted successfully.', undefined);
  } catch (err) {
    next(err);
  }
}

module.exports = { create, list, getOne, update, remove };
