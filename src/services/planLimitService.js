const supabase = require('../config/supabase');
const AppError = require('../utils/AppError');
const { toPublicPlan, toPublicUserQuota } = require('../utils/billingPublic');
const { DAILY_SEND_LIMIT, getTodaySentCount } = require('./mailSendLimitService');
const { countCampaignLeads } = require('../utils/campaignLeadStats');

const STARTER_PLAN_ID = 'starter';
const SUBSCRIPTION_LIMIT_STATUSES = new Set(['trialing', 'active', 'past_due']);

/**
 * Plan used for quota enforcement — prefer active subscription row, then users.current_plan_id.
 */
function resolvePlanIdForLimits({ subscription, currentPlanId }) {
  if (subscription && SUBSCRIPTION_LIMIT_STATUSES.has(subscription.status)) {
    return subscription.plan_id || currentPlanId || STARTER_PLAN_ID;
  }
  return currentPlanId || subscription?.plan_id || STARTER_PLAN_ID;
}

async function getUserPlanLimits(userId) {
  const [{ data: user, error: userErr }, { data: subscription, error: subErr }] = await Promise.all([
    supabase
      .from('users')
      .select('current_plan_id')
      .eq('id', userId)
      .is('deleted_at', null)
      .maybeSingle(),
    supabase.from('user_subscriptions').select('plan_id, status').eq('user_id', userId).maybeSingle(),
  ]);

  if (userErr) throw new AppError('Failed to load user plan.', 500);
  if (subErr) throw new AppError('Failed to load subscription.', 500);
  if (!user) throw new AppError('User not found.', 404);

  const planId = resolvePlanIdForLimits({
    subscription,
    currentPlanId: user.current_plan_id,
  });

  const { data: plan, error: planErr } = await supabase
    .from('plans')
    .select('*')
    .eq('id', planId)
    .maybeSingle();

  if (planErr) throw new AppError('Failed to load plan limits.', 500);
  if (!plan) {
    const { data: starter } = await supabase.from('plans').select('*').eq('id', STARTER_PLAN_ID).single();
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

async function getUserQuota(userId) {
  const plan = await getUserPlanLimits(userId);

  const { data: campaigns, error: campaignsErr } = await supabase
    .from('campaigns')
    .select('id, name')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (campaignsErr) throw new AppError('Failed to load campaigns.', 500);

  const campaignRows = campaigns || [];

  const campaignLeadUsage = await Promise.all(
    campaignRows.map(async (campaign) => {
      let leadsUsed = 0;
      try {
        leadsUsed = await countCampaignLeads(userId, { campaignId: campaign.id });
      } catch (err) {
        throw new AppError('Failed to count campaign leads.', 500);
      }
      return {
        campaignId: campaign.id,
        campaignName: campaign.name,
        leadsUsed,
      };
    })
  );

  const dailyEmailsUsed = await getTodaySentCount(userId);

  return toPublicUserQuota({
    plan,
    campaignsUsed: campaignRows.length,
    campaignLeadUsage,
    dailyEmailsUsed,
    dailyEmailLimit: DAILY_SEND_LIMIT,
  });
}

module.exports = {
  STARTER_PLAN_ID,
  SUBSCRIPTION_LIMIT_STATUSES,
  resolvePlanIdForLimits,
  getUserPlanLimits,
  getUserQuota,
  assertCanCreateCampaign,
  assertCanAddLeadsToCampaign,
  toPublicPlan,
};
