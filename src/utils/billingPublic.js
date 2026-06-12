function toPublicPlan(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    priceCents: row.price_cents,
    currency: row.currency,
    billingInterval: row.billing_interval,
    maxCampaigns: row.max_campaigns,
    maxLeadsPerCampaign: row.max_leads_per_campaign,
    sortOrder: row.sort_order,
  };
}

function toPublicSubscription(subRow, planRow) {
  if (!subRow) return null;
  return {
    planId: subRow.plan_id,
    plan: planRow ? toPublicPlan(planRow) : null,
    status: subRow.status,
    stripeSubscriptionId: subRow.stripe_subscription_id ?? null,
    currentPeriodStart: subRow.current_period_start ?? null,
    currentPeriodEnd: subRow.current_period_end ?? null,
    cancelAtPeriodEnd: subRow.cancel_at_period_end === true,
    canceledAt: subRow.canceled_at ?? null,
    limits: planRow
      ? {
          maxCampaigns: planRow.max_campaigns,
          maxLeadsPerCampaign: planRow.max_leads_per_campaign,
        }
      : null,
  };
}

function toQuotaUsage(limit, used) {
  const safeLimit = Math.max(0, Number(limit) || 0);
  const safeUsed = Math.max(0, Number(used) || 0);
  return {
    limit: safeLimit,
    used: safeUsed,
    available: Math.max(0, safeLimit - safeUsed),
  };
}

function toPublicUserQuota({
  plan,
  campaignsUsed,
  campaignLeadUsage,
  dailyEmailsUsed,
  dailyEmailLimit,
}) {
  const planPublic = plan ? toPublicPlan(plan) : null;
  const leadsLimit = plan?.max_leads_per_campaign ?? 0;

  return {
    plan: planPublic
      ? {
          id: planPublic.id,
          name: planPublic.name,
        }
      : null,
    campaigns: toQuotaUsage(plan?.max_campaigns ?? 0, campaignsUsed),
    leadsPerCampaign: {
      limit: leadsLimit,
      campaigns: (campaignLeadUsage || []).map((row) => ({
        campaignId: row.campaignId,
        campaignName: row.campaignName,
        ...toQuotaUsage(leadsLimit, row.leadsUsed),
      })),
    },
    dailyEmails: toQuotaUsage(dailyEmailLimit, dailyEmailsUsed),
  };
}

function toPublicPaymentMethod(pm, isDefault) {
  if (!pm || pm.type !== 'card' || !pm.card) return null;
  return {
    id: pm.id,
    brand: pm.card.brand,
    last4: pm.card.last4,
    expMonth: pm.card.exp_month,
    expYear: pm.card.exp_year,
    isDefault: Boolean(isDefault),
  };
}

module.exports = {
  toPublicPlan,
  toPublicSubscription,
  toQuotaUsage,
  toPublicUserQuota,
  toPublicPaymentMethod,
};
