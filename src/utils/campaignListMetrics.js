/**
 * Reply metrics for campaign list: rate as fraction and percentage.
 */
function computeReplyMetrics(sentCount, replyCount) {
  const sent = Number(sentCount) || 0;
  const replies = Number(replyCount) || 0;

  if (sent <= 0) {
    return { sent_count: 0, reply_rate: 0, reply_rate_percent: 0 };
  }

  const ratio = replies / sent;
  return {
    sent_count: sent,
    reply_rate: Math.round(ratio * 10000) / 10000,
    reply_rate_percent: Math.round(ratio * 1000) / 10,
  };
}

function formatCampaignLeadCounts(stats) {
  const sentCount = stats?.sent_count ?? 0;
  const replyCount = stats?.reply_count ?? 0;
  const metrics = computeReplyMetrics(sentCount, replyCount);

  return {
    total_leads: stats?.total_leads ?? 0,
    pending_count: stats?.pending_count ?? 0,
    failed_count: stats?.failed_count ?? 0,
    sent_count: metrics.sent_count,
    reply_rate: metrics.reply_rate,
    reply_rate_percent: metrics.reply_rate_percent,
  };
}

function formatCampaignListItem(campaign, stats) {
  return {
    id: campaign.id,
    name: campaign.name,
    goal: campaign.goal,
    run_mode: campaign.run_mode,
    target_leads: campaign.target_leads,
    status: campaign.status,
    ...formatCampaignLeadCounts(stats),
  };
}

module.exports = {
  computeReplyMetrics,
  formatCampaignLeadCounts,
  formatCampaignListItem,
};
