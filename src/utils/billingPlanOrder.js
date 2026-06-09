const PLAN_RANK = Object.freeze({
  starter: 0,
  growth: 1,
  pro: 2,
});

function planRank(planId) {
  return PLAN_RANK[planId] ?? -1;
}

function isUpgrade(fromPlanId, toPlanId) {
  return planRank(toPlanId) > planRank(fromPlanId);
}

function isDowngrade(fromPlanId, toPlanId) {
  return planRank(toPlanId) < planRank(fromPlanId);
}

function isPaidPlan(planId) {
  return planId === 'growth' || planId === 'pro';
}

module.exports = {
  PLAN_RANK,
  planRank,
  isUpgrade,
  isDowngrade,
  isPaidPlan,
};
