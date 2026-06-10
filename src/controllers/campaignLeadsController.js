const campaignLeadsService = require('../services/campaignLeadsService');
const { syncReplyFlagsForUser } = require('../services/gmailReplyDetectionService');
const supabase = require('../config/supabase');
const AppError = require('../utils/AppError');
const { successResponse, successResponsePaginated } = require('../utils/response');

function bulkAddLeadsMessage({ totalInserted, totalDuplicates }) {
  if (totalInserted === 0 && totalDuplicates > 0) {
    return totalDuplicates === 1
      ? 'This lead is already on the campaign.'
      : 'These leads are already on the campaign.';
  }
  if (totalInserted === 1 && totalDuplicates === 0) {
    return 'Lead added successfully.';
  }
  if (totalInserted > 0 && totalDuplicates === 0) {
    return `${totalInserted} leads added to campaign.`;
  }
  if (totalInserted > 0 && totalDuplicates > 0) {
    const added =
      totalInserted === 1 ? '1 lead added to campaign' : `${totalInserted} leads added to campaign`;
    const skipped =
      totalDuplicates === 1
        ? '1 was already on the campaign'
        : `${totalDuplicates} were already on the campaign`;
    return `${added}. ${skipped}.`;
  }
  return 'No leads were added.';
}

// ─── POST /campaigns/:id/leads/bulk ──────────────────────────────────────────
// Bulk-add leads to a campaign. Silently skips duplicates and reports them.

async function bulkAddLeads(req, res, next) {
  try {
    const { leads } = req.body;
    const campaignId = req.params.id;
    const userId = req.user.id;

    const result = await campaignLeadsService.bulkAddLeadsToCampaign(userId, campaignId, leads);

    return successResponse(
      res,
      201,
      bulkAddLeadsMessage(result),
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

    const ALLOWED = ['status', 'sent_at', 'mail_template', 'error_message', 'reply_received'];
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

    const message =
      updates.status != null
        ? `Lead status updated to ${updates.status}.`
        : 'Campaign lead updated.';

    return successResponse(res, 200, message, { lead });
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

    return successResponse(res, 200, 'Lead removed from campaign.', undefined);
  } catch (err) {
    next(err);
  }
}

// ─── POST /campaigns/:id/leads/sync-replies ───────────────────────────────────
// Scan Gmail threads for lead replies and update reply_received metrics.

async function syncReplies(req, res, next) {
  try {
    const campaignId = req.params.id;
    const userId = req.user.id;

    const { data: campaign, error } = await supabase
      .from('campaigns')
      .select('id')
      .eq('id', campaignId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !campaign) {
      throw new AppError('Campaign not found.', 404);
    }

    const summary = await syncReplyFlagsForUser(userId, { campaignId });
    return successResponse(res, 200, 'Reply sync completed.', summary);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  bulkAddLeads,
  listLeads,
  updateLead,
  removeLead,
  syncReplies,
};
