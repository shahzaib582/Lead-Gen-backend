// services/campaignLeadService.js

const supabase = require('../config/supabase');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { throwSupabaseError } = require('../utils/supabaseErrors');
const { parseLeadDataId } = require('../utils/leadDataId');
const { ensureMailTemplateJob } = require('../jobs/mailTemplateJob');
const { shouldAutoEnqueuePipeline } = require('./campaignPipelineRules');
const { applyLeadSourceFilter, shuffleInPlace } = require('./leadPoolQuery');

const VALID_STATUSES = ['pending', 'template_generated', 'sent', 'failed', 'skipped'];

/** Campaign must be out of draft before leads can be assigned (bulk / auto-assign). */
const LEAD_ADD_CAMPAIGN_STATUSES = ['active', 'paused', 'completed'];

function uniqueExcludedLeadDataIds(rows) {
  const ids = (rows || []).map((r) => parseLeadDataId(r.lead_data_id)).filter((v) => v != null);
  return [...new Set(ids)];
}

function leadDisplayName(leadRow) {
  if (!leadRow) return null;
  const full = leadRow.fullName != null ? String(leadRow.fullName).trim() : '';
  const first = leadRow.firstName != null ? String(leadRow.firstName).trim() : '';
  const email = leadRow.email != null ? String(leadRow.email).trim() : '';
  return full || first || email || null;
}

async function fetchLeadsDataMap(leadDataIds) {
  const parsedIds = [...new Set((leadDataIds || []).map(parseLeadDataId).filter((v) => v != null))];
  const map = new Map();
  if (parsedIds.length === 0) return map;

  const { data: rows, error } = await supabase
    .from('leads_data')
    .select('id, fullName, firstName, email, company')
    .in('id', parsedIds);

  if (error) {
    throw new AppError('Failed to load lead details.', 500);
  }

  for (const row of rows || []) {
    map.set(String(row.id), row);
  }
  return map;
}

function enrichCampaignLeadRow(campaignLead, leadsDataMap) {
  const key = String(parseLeadDataId(campaignLead.lead_data_id) ?? campaignLead.lead_data_id);
  const leadRow = leadsDataMap.get(key) || null;
  return {
    ...campaignLead,
    lead_name: leadDisplayName(leadRow),
    lead_email: leadRow?.email ?? null,
    lead_company: leadRow?.company ?? null,
  };
}

async function enrichCampaignLeadsWithLeadData(leads) {
  if (!leads?.length) return leads || [];
  const map = await fetchLeadsDataMap(leads.map((l) => l.lead_data_id));
  return leads.map((cl) => enrichCampaignLeadRow(cl, map));
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

async function assertCampaignOwnership(userId, campaignId) {
  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', campaignId)
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    throw new AppError('Campaign not found.', 404);
  }

  return data;
}

function assertCampaignAllowsLeadAdd(campaign) {
  if (!LEAD_ADD_CAMPAIGN_STATUSES.includes(campaign.status)) {
    throw new AppError(
      `Cannot add leads while campaign status is "${campaign.status}".`,
      400
    );
  }
}

// ─────────────────────────────────────────────────────────────
// Bulk Add Leads
// ─────────────────────────────────────────────────────────────

async function bulkAddLeadsToCampaign(userId, campaignId, leads) {
  const campaign = await assertCampaignOwnership(userId, campaignId);
  assertCampaignAllowsLeadAdd(campaign);

  const rows = leads.map((l) => ({
    user_id: userId,

    campaign_id: campaignId,

    lead_data_id: String(l.lead_data_id),

    status: 'pending',
  }));

  const { data, error } = await supabase
    .from('campaign_leads')
    .upsert(rows, {
      onConflict: 'campaign_id,lead_data_id',

      ignoreDuplicates: true,
    })
    .select();

  if (error) {
    throw new AppError(`Bulk insert failed: ${error.message}`, 500);
  }

  // ------------------------------------
  // Queue template jobs
  // ------------------------------------

  if (shouldAutoEnqueuePipeline(campaign)) {
    for (const lead of data || []) {
      await ensureMailTemplateJob({
        userId,
        campaignId,
        campaignLeadId: lead.id,
      });
    }
  }

  const insertedIds = new Set((data || []).map((r) => r.lead_data_id));

  const duplicates = leads.map((l) => String(l.lead_data_id)).filter((id) => !insertedIds.has(id));

  return {
    inserted: data || [],
    duplicates,

    totalInserted: (data || []).length,

    totalDuplicates: duplicates.length,
  };
}

// ─────────────────────────────────────────────────────────────
// Get Campaign Leads
// ─────────────────────────────────────────────────────────────

async function getCampaignLeads(userId, campaignId, { status, page = 1, limit = 20 } = {}) {
  await assertCampaignOwnership(userId, campaignId);

  let query = supabase
    .from('campaign_leads')
    .select('*', {
      count: 'exact',
    })
    .eq('campaign_id', campaignId)
    .eq('user_id', userId)
    .order('created_at', {
      ascending: false,
    })
    .range((page - 1) * limit, page * limit - 1);

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error, count } = await query;

  if (error) {
    throw new AppError('Failed to fetch campaign leads.', 500);
  }

  const leads = await enrichCampaignLeadsWithLeadData(data);

  return {
    leads,
    total: count,
    page,
    limit,
    totalPages: Math.ceil(count / limit),
  };
}

// ─────────────────────────────────────────────────────────────
// Get Single Lead
// ─────────────────────────────────────────────────────────────

async function getCampaignLeadRow(userId, campaignId, leadId) {
  await assertCampaignOwnership(userId, campaignId);

  const { data, error } = await supabase
    .from('campaign_leads')
    .select('*')
    .eq('id', leadId)
    .eq('campaign_id', campaignId)
    .eq('user_id', userId)
    .single();

  if (error?.code === 'PGRST116' || !data) {
    throw new AppError('Campaign lead not found.', 404);
  }
  if (error) {
    throwSupabaseError(error, {
      logLabel: 'campaign_leads get row',
      fallbackMessage: 'Failed to fetch campaign lead.',
      campaignLeadSchemaHint: true,
    });
  }

  return data;
}

async function getCampaignLeadById(userId, campaignId, leadId) {
  const row = await getCampaignLeadRow(userId, campaignId, leadId);
  const [enriched] = await enrichCampaignLeadsWithLeadData([row]);
  return enriched;
}

// ─────────────────────────────────────────────────────────────
// Update Lead
// ─────────────────────────────────────────────────────────────

async function updateCampaignLead(userId, campaignId, leadId, updates) {
  await getCampaignLeadRow(userId, campaignId, leadId);

  const payload = { ...updates };

  if (Object.prototype.hasOwnProperty.call(payload, 'reply_received')) {
    if (payload.reply_received === true && !payload.reply_received_at) {
      payload.reply_received_at = new Date().toISOString();
    }
    if (payload.reply_received === false) {
      payload.reply_received_at = null;
    }
  }

  const { data, error } = await supabase
    .from('campaign_leads')
    .update(payload)
    .eq('id', leadId)
    .eq('campaign_id', campaignId)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) {
    throwSupabaseError(error, {
      logLabel: 'campaign_leads update',
      fallbackMessage: 'Failed to update campaign lead.',
      campaignLeadSchemaHint: true,
    });
  }

  // ------------------------------------
  // Mirror outreach status (non-blocking)
  // ------------------------------------

  const MIRROR_STATUSES = {
    sent: 'contacted',
    failed: 'failed',
    skipped: 'skipped',
  };

  if (payload.status && MIRROR_STATUSES[payload.status]) {
    const leadsDataUpdate = {
      outreachStatus: MIRROR_STATUSES[payload.status],
    };

    if (payload.status === 'sent') {
      leadsDataUpdate.emailSent = 'true';
      leadsDataUpdate.emailSentDate = payload.sent_at || new Date().toISOString();
    }

    const { error: mirrorErr } = await supabase
      .from('leads_data')
      .update(leadsDataUpdate)
      .eq('id', parseLeadDataId(data.lead_data_id));

    if (mirrorErr) {
      logger.warn('[CampaignLead] Failed to mirror status to leads_data', {
        campaignLeadId: leadId,
        lead_data_id: data.lead_data_id,
        status: payload.status,
        error: mirrorErr.message,
      });
    }
  }

  try {
    const [enriched] = await enrichCampaignLeadsWithLeadData([data]);
    return enriched;
  } catch (err) {
    logger.warn('[CampaignLead] enrich after update failed', {
      campaignLeadId: leadId,
      error: err.message,
    });
    return {
      ...data,
      lead_name: null,
      lead_email: null,
      lead_company: null,
    };
  }
}

// ─────────────────────────────────────────────────────────────
// Remove Lead
// ─────────────────────────────────────────────────────────────

async function removeCampaignLead(userId, campaignId, leadId) {
  await getCampaignLeadById(userId, campaignId, leadId);

  const { error } = await supabase
    .from('campaign_leads')
    .delete()
    .eq('id', leadId)
    .eq('campaign_id', campaignId)
    .eq('user_id', userId);

  if (error) {
    throw new AppError('Failed to remove campaign lead.', 500);
  }
}

// ─────────────────────────────────────────────────────────────
// Assign Random Leads
// ─────────────────────────────────────────────────────────────

async function assignRandomLeadsToCampaign(userId, campaignId) {
  const campaign = await assertCampaignOwnership(userId, campaignId);
  assertCampaignAllowsLeadAdd(campaign);

  const targetCount = campaign.target_leads;

  if (!targetCount || targetCount <= 0) {
    throw new AppError('Campaign target_leads must be greater than 0.', 400);
  }

  // Existing assigned leads
  const { data: existing } = await supabase
    .from('campaign_leads')
    .select('lead_data_id')
    .eq('campaign_id', campaignId);

  const excludedIds = uniqueExcludedLeadDataIds(existing);

  let idsQuery = supabase.from('leads_data').select('id');

  const leadSource = campaign.lead_source || 'both';
  idsQuery = applyLeadSourceFilter(idsQuery, leadSource);

  if (excludedIds.length > 0) {
    idsQuery = idsQuery.notIn('id', excludedIds);
  }

  const { data: allLeads, error: leadsError } = await idsQuery;

  if (leadsError) {
    throw new AppError(leadsError.message, 500);
  }

  if (!allLeads || allLeads.length === 0) {
    throw new AppError('No available leads found.', 404);
  }

  shuffleInPlace(allLeads);
  const randomLeads = allLeads.slice(0, targetCount);

  const rows = randomLeads.map((l) => ({
    user_id: userId,

    campaign_id: campaignId,

    lead_data_id: String(l.id),

    status: 'pending',
  }));

  const { data: inserted, error: insertError } = await supabase
    .from('campaign_leads')
    .upsert(rows, {
      onConflict: 'campaign_id,lead_data_id',

      ignoreDuplicates: true,
    })
    .select();

  if (insertError) {
    throw new AppError(insertError.message, 500);
  }

  // ------------------------------------
  // Queue template generation
  // ------------------------------------

  if (shouldAutoEnqueuePipeline(campaign)) {
    for (const lead of inserted || []) {
      await ensureMailTemplateJob({
        userId,
        campaignId,
        campaignLeadId: lead.id,
      });
    }
  }

  const insertedIds = new Set((inserted || []).map((r) => r.lead_data_id));

  const duplicates = randomLeads.map((l) => String(l.id)).filter((id) => !insertedIds.has(id));

  return {
    inserted: inserted || [],

    duplicates,

    totalRequested: targetCount,

    totalAvailable: randomLeads.length,

    totalInserted: (inserted || []).length,

    totalDuplicates: duplicates.length,

    leadSource,
  };
}

module.exports = {
  VALID_STATUSES,

  bulkAddLeadsToCampaign,

  getCampaignLeads,

  getCampaignLeadById,

  updateCampaignLead,

  removeCampaignLead,

  assignRandomLeadsToCampaign,
};
