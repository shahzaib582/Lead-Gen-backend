const supabase = require('../config/supabase');

function pickNonEmpty(...values) {
  for (const v of values) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

/**
 * Merge campaign sender_* fields with user profile (users.name, address, contact).
 * Campaign values win when set; otherwise fall back to the account owner.
 *
 * @param {object} campaign
 * @param {{ name?: string|null, address?: string|null, contact?: string|null }|null} [user]
 * @returns {object} campaign-shaped object with resolved sender_* fields
 */
function resolveCampaignSender(campaign, user = null) {
  return {
    ...campaign,
    sender_display_name: pickNonEmpty(campaign.sender_display_name, user?.name),
    sender_address: pickNonEmpty(campaign.sender_address, user?.address),
    sender_phone: pickNonEmpty(campaign.sender_phone, user?.contact),
  };
}

async function fetchUserSenderProfile(userId) {
  const { data, error } = await supabase
    .from('users')
    .select('name, address, contact')
    .eq('id', userId)
    .maybeSingle();

  if (error) return null;
  return data;
}

/**
 * Load user profile and resolve sender fields for a campaign.
 * @param {object} campaign
 * @param {string} userId
 */
async function resolveCampaignSenderForUser(campaign, userId) {
  const user = await fetchUserSenderProfile(userId);
  return resolveCampaignSender(campaign, user);
}

module.exports = {
  pickNonEmpty,
  resolveCampaignSender,
  fetchUserSenderProfile,
  resolveCampaignSenderForUser,
};
