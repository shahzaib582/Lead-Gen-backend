const supabase = require('../config/supabase');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { throwSupabaseError } = require('../utils/supabaseErrors');
const { formatCampaignListItem } = require('../utils/campaignListMetrics');

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

async function fetchCampaignLeadStatsMap(userId, campaignIds) {
  const map = new Map();
  for (const id of campaignIds) {
    map.set(id, { sent_count: 0, reply_count: 0 });
  }
  if (campaignIds.length === 0) return map;

  let selectCols = 'campaign_id, status, reply_received';
  let { data, error } = await supabase
    .from('campaign_leads')
    .select(selectCols)
    .eq('user_id', userId)
    .in('campaign_id', campaignIds);

  if (error && /reply_received|column/i.test(`${error.message} ${error.details}`)) {
    selectCols = 'campaign_id, status';
    ({ data, error } = await supabase
      .from('campaign_leads')
      .select(selectCols)
      .eq('user_id', userId)
      .in('campaign_id', campaignIds));
  }

  if (error) {
    logger.warn('[Campaigns] Failed to load lead stats for list', { error: error.message });
    return map;
  }

  for (const row of data || []) {
    const stats = map.get(row.campaign_id);
    if (!stats) continue;
    if (row.status === 'sent') stats.sent_count += 1;
    if (row.reply_received === true) stats.reply_count += 1;
  }

  return map;
}

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
  const statsMap = await fetchCampaignLeadStatsMap(userId, campaignIds);
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
  return data;
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
