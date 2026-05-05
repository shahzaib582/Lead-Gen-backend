const supabase = require('../config/supabase');
const AppError = require('../utils/AppError');

const VALID_STATUSES = ['pending', 'sent', 'failed', 'skipped'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Verify the campaign exists and belongs to the requesting user.
 * Throws 404 if not found / not owned.
 */
async function assertCampaignOwnership(userId, campaignId) {
  const { data, error } = await supabase
    .from('campaigns')
    .select('id')
    .eq('id', campaignId)
    .eq('user_id', userId)
    .single();

  if (error || !data) throw new AppError('Campaign not found.', 404);
}

// ─── Add a single lead to a campaign ─────────────────────────────────────────

async function addLeadToCampaign(userId, campaignId, { lead_data_id, mail_template }) {
  await assertCampaignOwnership(userId, campaignId);

  const { data, error } = await supabase
    .from('campaign_leads')
    .insert({
      user_id:      userId,
      campaign_id:  campaignId,
      lead_data_id: String(lead_data_id),
      mail_template: mail_template || null,
      status:       'pending',
    })
    .select()
    .single();

  if (error) {
    // Unique constraint: campaign_id + lead_data_id
    if (error.code === '23505') {
      throw new AppError('This lead is already added to the campaign.', 409);
    }
    throw new AppError(`Failed to add lead to campaign: ${error.message}`, 500);
  }

  return data;
}

// ─── Bulk add leads to a campaign ────────────────────────────────────────────

/**
 * @param {string} userId
 * @param {string} campaignId
 * @param {Array<{ lead_data_id: string, mail_template?: string }>} leads
 * @returns {{ inserted: object[], duplicates: string[], errors: string[] }}
 */
async function bulkAddLeadsToCampaign(userId, campaignId, leads) {
  await assertCampaignOwnership(userId, campaignId);

  const rows = leads.map((l) => ({
    user_id:       userId,
    campaign_id:   campaignId,
    lead_data_id:  String(l.lead_data_id),
    mail_template: l.mail_template || null,
    status:        'pending',
  }));

  // Use upsert with ignoreDuplicates so duplicates are skipped, not errored
  const { data, error } = await supabase
    .from('campaign_leads')
    .upsert(rows, {
      onConflict:       'campaign_id,lead_data_id',
      ignoreDuplicates: true,
    })
    .select();

  if (error) {
    throw new AppError(`Bulk insert failed: ${error.message}`, 500);
  }

  const insertedIds  = new Set((data || []).map((r) => r.lead_data_id));
  const duplicates   = leads
    .map((l) => String(l.lead_data_id))
    .filter((id) => !insertedIds.has(id));

  return {
    inserted:   data || [],
    duplicates,            // lead_data_ids that were already in the campaign
    totalInserted: (data || []).length,
    totalDuplicates: duplicates.length,
  };
}

// ─── List leads for a campaign ────────────────────────────────────────────────

async function getCampaignLeads(userId, campaignId, { status, page = 1, limit = 20 } = {}) {
  await assertCampaignOwnership(userId, campaignId);

  let query = supabase
    .from('campaign_leads')
    .select('*', { count: 'exact' })
    .eq('campaign_id', campaignId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  if (status) query = query.eq('status', status);

  const { data, error, count } = await query;
  if (error) throw new AppError('Failed to fetch campaign leads.', 500);

  return {
    leads: data,
    total: count,
    page,
    limit,
    totalPages: Math.ceil(count / limit),
  };
}

// ─── Get a single campaign lead ───────────────────────────────────────────────

async function getCampaignLeadById(userId, campaignId, leadId) {
  await assertCampaignOwnership(userId, campaignId);

  const { data, error } = await supabase
    .from('campaign_leads')
    .select('*')
    .eq('id', leadId)
    .eq('campaign_id', campaignId)
    .eq('user_id', userId)
    .single();

  if (error || !data) throw new AppError('Campaign lead not found.', 404);
  return data;
}

// ─── Update a campaign lead ───────────────────────────────────────────────────
//
// When status transitions to 'sent', we mirror the contact event back to the
// leads_data row so that lead_source filtering stays accurate across campaigns:
//
//   leads_data.outreachStatus  ← 'contacted'
//   leads_data.emailSent       ← 'true'
//   leads_data.emailSentDate   ← ISO timestamp of the send
//
// This makes leads_data the single source of truth for "has this person ever
// been contacted?" — which is exactly what lead_source:'new' / 'old' queries.

async function updateCampaignLead(userId, campaignId, leadId, updates) {
  // Confirm it exists and belongs to user; also grab lead_data_id for mirror step
  const existing = await getCampaignLeadById(userId, campaignId, leadId);

  const { data, error } = await supabase
    .from('campaign_leads')
    .update(updates)
    .eq('id', leadId)
    .eq('campaign_id', campaignId)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) throw new AppError('Failed to update campaign lead.', 500);

  // ── Mirror to leads_data when status changes to a terminal state ────────────
  //
  // Status → leads_data fields updated:
  //
  //   'sent'    → outreachStatus:'contacted', emailSent:'true', emailSentDate:<ts>
  //   'failed'  → outreachStatus:'failed'    (email bounced / send error)
  //   'skipped' → outreachStatus:'skipped'   (intentionally not sent)
  //
  // 'pending' is not mirrored — the lead hasn't been acted on yet.
  //
  // This keeps leads_data as the cross-campaign source of truth so that
  // lead_source:'new' / 'old' filters stay accurate in future campaigns.

  const MIRROR_STATUSES = { sent: 'contacted', failed: 'failed', skipped: 'skipped' };

  if (updates.status && MIRROR_STATUSES[updates.status]) {
    const leadsDataUpdate = {
      outreachStatus: MIRROR_STATUSES[updates.status],
    };

    // Only populate email fields on a successful send
    if (updates.status === 'sent') {
      leadsDataUpdate.emailSent     = 'true';
      leadsDataUpdate.emailSentDate = updates.sent_at || new Date().toISOString();
    }

    const { error: mirrorError } = await supabase
      .from('leads_data')
      .update(leadsDataUpdate)
      .eq('id', Number(existing.lead_data_id));

    if (mirrorError) {
      // Non-fatal — log but don't roll back. The campaign_lead is already
      // updated; a failed mirror should not surface as a 500 to the caller.
      const logger = require('../utils/logger');
      logger.warn('Failed to mirror status to leads_data', {
        leadId,
        lead_data_id: existing.lead_data_id,
        newStatus:    updates.status,
        error:        mirrorError.message,
      });
    }
  }

  return data;
}

// ─── Remove a lead from a campaign ───────────────────────────────────────────

async function removeCampaignLead(userId, campaignId, leadId) {
  await getCampaignLeadById(userId, campaignId, leadId);

  const { error } = await supabase
    .from('campaign_leads')
    .delete()
    .eq('id', leadId)
    .eq('campaign_id', campaignId)
    .eq('user_id', userId);

  if (error) throw new AppError('Failed to remove campaign lead.', 500);
}

// ─── Assign random leads from leads_data to a campaign ───────────────────────
//
// Reads `target_leads` from the campaign row, fetches that many random rows
// from the `leads_data` table (excluding any already assigned to the campaign),
// and bulk-inserts them into `campaign_leads`.
//
// Returns the same shape as bulkAddLeadsToCampaign so callers stay consistent.

async function assignRandomLeadsToCampaign(userId, campaignId) {
  // 1. Verify ownership and fetch target_leads count
  const { data: campaign, error: campError } = await supabase
    .from('campaigns')
    .select('id, target_leads, lead_source')
    .eq('id', campaignId)
    .eq('user_id', userId)
    .single();

  if (campError || !campaign) throw new AppError('Campaign not found.', 404);

  const targetCount = campaign.target_leads;
  if (!targetCount || targetCount <= 0) {
    throw new AppError('Campaign target_leads must be greater than 0.', 400);
  }

  // 2. Find lead_data_ids already assigned to this campaign so we can exclude them.
  //    leads_data.id is a bigint; campaign_leads.lead_data_id is stored as text.
  //    We cast to number here so the .not('id','in',...) filter does a numeric
  //    comparison against the bigint column — passing plain strings would cause
  //    a Postgres type mismatch and silently exclude nothing (or error).
  const { data: existing, error: existingError } = await supabase
    .from('campaign_leads')
    .select('lead_data_id')
    .eq('campaign_id', campaignId);

  if (existingError) throw new AppError('Failed to fetch existing campaign leads.', 500);

  // Convert stored text IDs back to numbers so the IN filter matches the bigint column
  const excludedIds = (existing || [])
    .map((r) => Number(r.lead_data_id))
    .filter((n) => !isNaN(n));

  // 3. Fetch all available lead IDs (excluding already-assigned ones), then
  //    pick `targetCount` of them at random using a Fisher-Yates shuffle in JS.
  //    PostgREST does not support ORDER BY random() via the .order() helper,
  //    so we do the randomisation on the Node side instead.
  //
  //    lead_source controls which pool of leads_data rows is eligible:
  //      'new'  — leads never contacted before (outreachStatus is null or empty)
  //      'old'  — leads previously contacted   (outreachStatus is not null/empty)
  //      'both' — no outreachStatus filter (default when not set)

  const leadSource = campaign.lead_source || 'both';

  let idsQuery = supabase
    .from('leads_data')
    .select('id');

  if (leadSource === 'new') {
    // Never-contacted leads: outreachStatus column is null or an empty string
    idsQuery = idsQuery.or('outreachStatus.is.null,outreachStatus.eq.');
  } else if (leadSource === 'old') {
    // Previously-contacted leads: outreachStatus has a value
    idsQuery = idsQuery.not('outreachStatus', 'is', null)
                       .neq('outreachStatus', '');
  }
  // 'both' — no extra filter

  if (excludedIds.length > 0) {
    // Pass numeric IDs — matches the bigint column correctly
    idsQuery = idsQuery.not('id', 'in', `(${excludedIds.join(',')})`);
  }

  const { data: allLeads, error: leadsError } = await idsQuery;

  if (leadsError) throw new AppError(`Failed to fetch random leads: ${leadsError.message}`, 500);
  if (!allLeads || allLeads.length === 0) {
    throw new AppError('No available leads found in leads_data to assign.', 404);
  }

  // Fisher-Yates in-place shuffle, then slice to targetCount
  for (let i = allLeads.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allLeads[i], allLeads[j]] = [allLeads[j], allLeads[i]];
  }
  const randomLeads = allLeads.slice(0, targetCount);

  // 4. Bulk-insert into campaign_leads.
  //    Store lead_data_id as a string (text column) — the bigint id is safe to
  //    stringify since JS numbers can exactly represent all 64-bit integer values
  //    that Postgres uses for bigint identity columns in practice.
  const rows = randomLeads.map((l) => ({
    user_id:      userId,
    campaign_id:  campaignId,
    lead_data_id: String(l.id),   // bigint → text, matches campaign_leads column type
    status:       'pending',
  }));

  const { data: inserted, error: insertError } = await supabase
    .from('campaign_leads')
    .upsert(rows, {
      onConflict:       'campaign_id,lead_data_id',
      ignoreDuplicates: true,
    })
    .select();

  if (insertError) throw new AppError(`Failed to assign leads: ${insertError.message}`, 500);

  const insertedIds  = new Set((inserted || []).map((r) => r.lead_data_id));
  const duplicates   = randomLeads
    .map((l) => String(l.id))
    .filter((id) => !insertedIds.has(id));

  return {
    inserted:        inserted || [],
    duplicates,
    totalRequested:  targetCount,
    totalAvailable:  randomLeads.length,
    totalInserted:   (inserted || []).length,
    totalDuplicates: duplicates.length,
    leadSource,      // 'new' | 'old' | 'both' — the filter that was applied
  };
}

module.exports = {
  VALID_STATUSES,
  addLeadToCampaign,
  bulkAddLeadsToCampaign,
  getCampaignLeads,
  getCampaignLeadById,
  updateCampaignLead,
  removeCampaignLead,
  assignRandomLeadsToCampaign,
};