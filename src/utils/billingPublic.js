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
  toPublicPaymentMethod,
};
