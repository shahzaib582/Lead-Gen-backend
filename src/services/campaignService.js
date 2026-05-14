const supabase = require('../config/supabase');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

function isLikelyMissingCampaignColumns(dbError) {
  const msg = `${dbError?.message || ''} ${dbError?.details || ''} ${dbError?.hint || ''}`;
  const code = dbError?.code || '';
  // Postgres: undefined_column; PostgREST: "schema cache" / unknown column (e.g. PGRST204)
  return (
    code === '42703' ||
    (/^PGRST/.test(code) && /column|schema cache/i.test(msg)) ||
    /Could not find the ['"]?\w+['"]? column/i.test(msg) ||
    /column .* does not exist/i.test(msg) ||
    /schema cache/i.test(msg)
  );
}

// ─── Create ───────────────────────────────────────────────────────────────────

async function createCampaign(userId, fields) {
  const { data, error } = await supabase
    .from('campaigns')
    .insert({ user_id: userId, ...fields })
    .select()
    .single();

  if (error) {
    logger.error('[campaigns] create insert failed', {
      userId,
      supabaseCode: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });

    if (error.code === '23505') {
      throw new AppError('A campaign with this name already exists.', 409);
    }

    if (isLikelyMissingCampaignColumns(error)) {
      throw new AppError(
        'Database is missing columns the API expects on `campaigns` (e.g. `lead_source`, `sender_display_name`). Run `sql/campaign_sender_fields.sql` in the Supabase SQL editor (see repo), then retry.',
        500,
        'CAMPAIGN_DB_SCHEMA'
      );
    }

    throw new AppError('Failed to create campaign.', 500, 'CAMPAIGN_CREATE_FAILED');
  }

  return data;
}

// ─── Read ─────────────────────────────────────────────────────────────────────

async function getCampaigns(userId, { status, page = 1, limit = 20 } = {}) {
  let query = supabase
    .from('campaigns')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  if (status) query = query.eq('status', status);

  const { data, error, count } = await query;
  if (error) throw new AppError('Failed to fetch campaigns.', 500);

  return { campaigns: data, total: count, page, limit };
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
