const supabase = require('../config/supabase');
const AppError = require('../utils/AppError');
const { toPublicPlan } = require('../utils/billingPublic');

async function getUserPlanLimits(userId) {
  const { data: user, error: userErr } = await supabase
    .from('users')
    .select('current_plan_id')
    .eq('id', userId)
    .is('deleted_at', null)
    .maybeSingle();

  if (userErr) throw new AppError('Failed to load user plan.', 500);
  if (!user) throw new AppError('User not found.', 404);

  const planId = user.current_plan_id || 'starter';

  const { data: plan, error: planErr } = await supabase
    .from('plans')
    .select('*')
    .eq('id', planId)
    .maybeSingle();

  if (planErr) throw new AppError('Failed to load plan limits.', 500);
  if (!plan) {
    const { data: starter } = await supabase.from('plans').select('*').eq('id', 'starter').single();
    return starter;
  }

  return plan;
}

async function assertCanCreateCampaign(userId) {
  const plan = await getUserPlanLimits(userId);

  const { count, error } = await supabase
    .from('campaigns')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);

  if (error) throw new AppError('Failed to count campaigns.', 500);

  if ((count || 0) >= plan.max_campaigns) {
    throw new AppError(
      `Campaign limit reached (${plan.max_campaigns} on ${plan.name} plan). Upgrade to add more campaigns.`,
      403,
      'PLAN_LIMIT_CAMPAIGNS'
    );
  }
}

async function assertCanAddLeadsToCampaign(userId, campaignId, additionalCount = 1) {
  const plan = await getUserPlanLimits(userId);

  const { count, error } = await supabase
    .from('campaign_leads')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .eq('user_id', userId);

  if (error) throw new AppError('Failed to count campaign leads.', 500);

  const nextTotal = (count || 0) + additionalCount;
  if (nextTotal > plan.max_leads_per_campaign) {
    throw new AppError(
      `Lead limit reached (${plan.max_leads_per_campaign} per campaign on ${plan.name} plan). Upgrade to add more leads.`,
      403,
      'PLAN_LIMIT_LEADS'
    );
  }
}

module.exports = {
  getUserPlanLimits,
  assertCanCreateCampaign,
  assertCanAddLeadsToCampaign,
  toPublicPlan,
};
