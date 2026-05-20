const supabase = require('../config/supabase');
const { isFollowUpDue } = require('../utils/followUpDueDate');
const { sendFollowUpEmail } = require('./campaignFollowUpMailerService');
const { syncReplyFlagsBeforeFollowUps } = require('./gmailReplyDetectionService');
const { randomDelayMs } = require('../config/mailDelay');
const logger = require('../utils/logger');

function hasUsableBodyTemplate(followUp) {
  return Boolean(followUp.body_template && String(followUp.body_template).trim());
}

function deliveryKey(campaignLeadId, followUpId) {
  return `${campaignLeadId}:${followUpId}`;
}

/**
 * Build list of due follow-up sends for active campaigns (anchored to initial sent_at).
 * @param {Date} [now]
 */
async function findDueFollowUpItems(now = new Date()) {
  const { data: followUpDefs, error: fuErr } = await supabase
    .from('campaign_follow_ups')
    .select('id, campaign_id, waiting_days, body_template, name, created_at')
    .not('body_template', 'is', null)
    .neq('body_template', '')
    .order('waiting_days', { ascending: true })
    .order('created_at', { ascending: true });

  if (fuErr) {
    logger.error('[FollowUpScheduler] Failed to load follow-up definitions', { error: fuErr.message });
    return [];
  }

  const defsByCampaign = new Map();
  for (const fu of followUpDefs || []) {
    if (!hasUsableBodyTemplate(fu)) continue;
    if (!defsByCampaign.has(fu.campaign_id)) defsByCampaign.set(fu.campaign_id, []);
    defsByCampaign.get(fu.campaign_id).push(fu);
  }

  const campaignIds = [...defsByCampaign.keys()];
  if (campaignIds.length === 0) return [];

  const { data: campaigns, error: campErr } = await supabase
    .from('campaigns')
    .select('id, user_id')
    .eq('status', 'active')
    .in('id', campaignIds);

  if (campErr) {
    logger.error('[FollowUpScheduler] Failed to load campaigns', { error: campErr.message });
    return [];
  }

  const dueItems = [];

  for (const campaign of campaigns || []) {
    const followUps = defsByCampaign.get(campaign.id) || [];
    if (followUps.length === 0) continue;

    const { data: leads, error: leadsErr } = await supabase
      .from('campaign_leads')
      .select('id, sent_at, reply_received')
      .eq('campaign_id', campaign.id)
      .eq('user_id', campaign.user_id)
      .eq('status', 'sent')
      .eq('reply_received', false)
      .not('sent_at', 'is', null);

    if (leadsErr) {
      logger.warn('[FollowUpScheduler] Failed to load sent leads', {
        campaignId: campaign.id,
        error: leadsErr.message,
      });
      continue;
    }

    if (!leads?.length) continue;

    const leadIds = leads.map((l) => l.id);
    const { data: deliveries } = await supabase
      .from('campaign_lead_follow_ups')
      .select('campaign_lead_id, follow_up_id, status')
      .in('campaign_lead_id', leadIds);

    const sentSet = new Set(
      (deliveries || [])
        .filter((d) => d.status === 'sent')
        .map((d) => deliveryKey(d.campaign_lead_id, d.follow_up_id))
    );

    for (const lead of leads) {
      if (lead.reply_received) continue;

      for (const followUp of followUps) {
        if (sentSet.has(deliveryKey(lead.id, followUp.id))) continue;
        if (!isFollowUpDue(lead.sent_at, followUp.waiting_days, now)) continue;

        dueItems.push({
          userId: campaign.user_id,
          campaignId: campaign.id,
          campaignLeadId: lead.id,
          followUpId: followUp.id,
          followUpName: followUp.name,
          waitingDays: followUp.waiting_days,
        });
      }
    }
  }

  return dueItems;
}

function randomDelay() {
  const ms = randomDelayMs();
  return new Promise((resolve) => setTimeout(() => resolve(ms), ms));
}

/**
 * Scan for due follow-ups and send plain-text emails sequentially with inter-send delay.
 */
async function processDueFollowUps() {
  await syncReplyFlagsBeforeFollowUps();

  const dueItems = await findDueFollowUpItems();
  const summary = {
    examined: dueItems.length,
    sent: 0,
    failed: 0,
    skipped: 0,
    results: [],
  };

  logger.info('[FollowUpScheduler] Processing due follow-ups', { count: dueItems.length });

  for (let i = 0; i < dueItems.length; i++) {
    const item = dueItems[i];
    try {
      const result = await sendFollowUpEmail({
        userId: item.userId,
        campaignId: item.campaignId,
        campaignLeadId: item.campaignLeadId,
        followUpId: item.followUpId,
      });

      summary.results.push({ ...item, ...result });

      if (result.status === 'sent') summary.sent++;
      else if (result.status === 'failed') summary.failed++;
      else summary.skipped++;
    } catch (err) {
      summary.failed++;
      summary.results.push({
        ...item,
        status: 'failed',
        error: err.message,
      });
      logger.error('[FollowUpScheduler] Unexpected error sending follow-up', {
        ...item,
        error: err.message,
      });
    }

    if (i < dueItems.length - 1) {
      await randomDelay();
    }
  }

  logger.info('[FollowUpScheduler] Run complete', {
    sent: summary.sent,
    failed: summary.failed,
    skipped: summary.skipped,
  });

  return summary;
}

module.exports = {
  findDueFollowUpItems,
  processDueFollowUps,
};
