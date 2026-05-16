const supabase = require('../config/supabase');
const AppError = require('../utils/AppError');
const campaignService = require('./campaignService');

async function listFollowUps(userId, campaignId) {
  await campaignService.getCampaignById(userId, campaignId);

  const { data, error } = await supabase
    .from('campaign_follow_ups')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('waiting_days', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw new AppError('Failed to fetch campaign follow-ups.', 500);
  return data || [];
}

async function getFollowUpById(userId, campaignId, followUpId) {
  await campaignService.getCampaignById(userId, campaignId);

  const { data, error } = await supabase
    .from('campaign_follow_ups')
    .select('*')
    .eq('id', followUpId)
    .eq('campaign_id', campaignId)
    .maybeSingle();

  if (error) throw new AppError('Failed to fetch follow-up.', 500);
  if (!data) throw new AppError('Follow-up not found.', 404);
  return data;
}

async function createFollowUp(userId, campaignId, { name, waiting_days }) {
  await campaignService.getCampaignById(userId, campaignId);

  const { data, error } = await supabase
    .from('campaign_follow_ups')
    .insert({
      campaign_id: campaignId,
      name: name.trim(),
      waiting_days,
    })
    .select()
    .single();

  if (error) throw new AppError(error.message || 'Failed to create follow-up.', 500);
  return data;
}

async function updateFollowUp(userId, campaignId, followUpId, updates) {
  await getFollowUpById(userId, campaignId, followUpId);

  const payload = {};
  if (updates.name !== undefined) payload.name = String(updates.name).trim();
  if (updates.waiting_days !== undefined) payload.waiting_days = updates.waiting_days;

  if (Object.keys(payload).length === 0) {
    throw new AppError('No valid fields provided for update.', 400);
  }

  const { data, error } = await supabase
    .from('campaign_follow_ups')
    .update(payload)
    .eq('id', followUpId)
    .eq('campaign_id', campaignId)
    .select()
    .single();

  if (error) throw new AppError(error.message || 'Failed to update follow-up.', 500);
  return data;
}

async function deleteFollowUp(userId, campaignId, followUpId) {
  await getFollowUpById(userId, campaignId, followUpId);

  const { error } = await supabase
    .from('campaign_follow_ups')
    .delete()
    .eq('id', followUpId)
    .eq('campaign_id', campaignId);

  if (error) throw new AppError('Failed to delete follow-up.', 500);
}

module.exports = {
  listFollowUps,
  getFollowUpById,
  createFollowUp,
  updateFollowUp,
  deleteFollowUp,
};
