const supabase = require('../config/supabase');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { throwSupabaseError } = require('../utils/supabaseErrors');
const {
  formatCampaignListItem,
  formatCampaignLeadCounts,
} = require('../utils/campaignListMetrics');
const {
  EMPTY_CAMPAIGN_LEAD_STATS,
  fetchCampaignLeadStatsMap,
} = require('../utils/campaignLeadStats');

// ─── Create ───────────────────────────────────────────────────────────────────

async function createCampaign(userId, fields) {
  const { assertCanCreateCampaign } = require('./planLimitService');
  await assertCanCreateCampaign(userId);

  const { data, error } = await supabase
    .from('campaigns')
    .insert({ user_id: userId, ...fields })
    .select()
    .single();

  if (error) {
    throwSupabaseError(error, {
      logLabel: 'campaigns create',
      fallbackMessage: 'Failed to create campaign.',
      duplicateMessage: 'A campaign with this name already exists.',
      schemaHint: true,
    });
  }

  return data;
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/** Safe term for PostgREST ilike filters (commas break `.or()`). */
function sanitizeCampaignSearchTerm(search) {
  return String(search || '')
    .trim()
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
    .replace(/,/g, ' ');
}

async function getCampaigns(userId, { status, search, page = 1, limit = 20 } = {}) {
  let query = supabase
    .from('campaigns')
    .select('id, name, goal, run_mode, target_leads, status', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  const term = sanitizeCampaignSearchTerm(search);
  if (term) {
    query = query.or(`name.ilike.%${term}%,goal.ilike.%${term}%`);
  }

  if (status) query = query.eq('status', status);

  const { data, error, count } = await query;
  if (error) throw new AppError('Failed to fetch campaigns.', 500);

  const campaignIds = (data || []).map((c) => c.id);
  let statsMap;
  try {
    statsMap = await fetchCampaignLeadStatsMap(userId, campaignIds);
  } catch (err) {
    logger.warn('[Campaigns] Failed to load lead stats for list', { error: err.message });
    statsMap = new Map(campaignIds.map((id) => [id, { ...EMPTY_CAMPAIGN_LEAD_STATS }]));
  }
  const campaigns = (data || []).map((c) => formatCampaignListItem(c, statsMap.get(c.id)));

  return { campaigns, total: count, page, limit };
}

async function getCampaignById(userId, campaignId) {
  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', campaignId)
    .eq('user_id', userId) // enforce ownership
    .single();

  if (error || !data) throw new AppError('Campaign not found.', 404);

  let stats = { ...EMPTY_CAMPAIGN_LEAD_STATS };
  try {
    const statsMap = await fetchCampaignLeadStatsMap(userId, [campaignId]);
    stats = statsMap.get(campaignId) || stats;
  } catch (err) {
    logger.warn('[Campaigns] Failed to load lead stats for detail', {
      campaignId,
      error: err.message,
    });
  }

  return {
    ...data,
    ...formatCampaignLeadCounts(stats),
  };
}

// ─── Update ───────────────────────────────────────────────────────────────────

async function updateCampaign(userId, campaignId, updates) {
  // Ensure campaign exists and belongs to user
  await getCampaignById(userId, campaignId);

  const { data, error } = await supabase
    .from('campaigns')
    .update(updates)
    .eq('id', campaignId)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) throw new AppError('Failed to update campaign.', 500);
  return data;
}

// ─── Delete ───────────────────────────────────────────────────────────────────

async function deleteCampaign(userId, campaignId) {
  // Ensure campaign exists and belongs to user
  await getCampaignById(userId, campaignId);

  const { error } = await supabase
    .from('campaigns')
    .delete()
    .eq('id', campaignId)
    .eq('user_id', userId);

  if (error) throw new AppError('Failed to delete campaign.', 500);
}

module.exports = {
  createCampaign,
  getCampaigns,
  getCampaignById,
  updateCampaign,
  deleteCampaign,
};
