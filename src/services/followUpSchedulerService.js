const { fetchAllRows } = require('../utils/fetchAllRows');
const supabase = require('../config/supabase');
const { isFollowUpDue } = require('../utils/followUpDueDate');
const { sendFollowUpEmail } = require('./campaignFollowUpMailerService');
const { syncReplyFlagsBeforeFollowUps } = require('./gmailReplyDetectionService');
const { syncThankYouDraftsBeforeFollowUps } = require('./thankYouDraftService');
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
async function findDueFollowUpItems(now = new Date(), options = {}) {
  const {
    userId = null,
    campaignId = null,
    ignoreWaitingDays = false,
    campaignLeadId = null,
    followUpId = null,
  } = options;

  const followUpDefs = await fetchAllRows(() =>
    supabase
      .from('campaign_follow_ups')
      .select('id, campaign_id, waiting_days, body_template, name, created_at')
      .not('body_template', 'is', null)
      .neq('body_template', '')
      .order('waiting_days')
      .order('created_at')
      .order('id')
  );

  const filteredDefs = (followUpDefs || []).filter((fu) => {
    if (campaignId && fu.campaign_id !== campaignId) return false;
    if (followUpId && fu.id !== followUpId) return false;
    return true;
  });

  const defsByCampaign = new Map();
  for (const fu of filteredDefs) {
    if (!hasUsableBodyTemplate(fu)) continue;
    if (!defsByCampaign.has(fu.campaign_id)) defsByCampaign.set(fu.campaign_id, []);
    defsByCampaign.get(fu.campaign_id).push(fu);
  }

  const campaignIds = [...defsByCampaign.keys()];
  if (campaignIds.length === 0) return [];

  const campaigns = await fetchAllRows(() =>
    supabase
      .from('campaigns')
      .select('id, user_id')
      .eq('status', 'active')
      .in('id', campaignIds)
      .order('id')
  );

  const dueItems = [];

  for (const campaign of campaigns || []) {
    if (userId && campaign.user_id !== userId) continue;

    const followUps = defsByCampaign.get(campaign.id) || [];
    if (followUps.length === 0) continue;

    const leads = await fetchAllRows(() =>
      supabase
        .from('campaign_leads')
        .select('id, sent_at, reply_received')
        .eq('campaign_id', campaign.id)
        .eq('user_id', campaign.user_id)
        .eq('status', 'sent')
        .eq('reply_received', false)
        .not('sent_at', 'is', null)
        .order('id')
    );

    if (!leads?.length) continue;

    const leadIds = leads.map((l) => l.id);
    const deliveries = [];
    for (let offset = 0; offset < leadIds.length; offset += 100) {
      const ids = leadIds.slice(offset, offset + 100);
      deliveries.push(
        ...(await fetchAllRows(() =>
          supabase
            .from('campaign_lead_follow_ups')
            .select('id, campaign_lead_id, follow_up_id, status')
            .in('campaign_lead_id', ids)
            .order('id')
        ))
      );
    }

    const sentSet = new Set(
      (deliveries || [])
        .filter((d) => d.status === 'sent')
        .map((d) => deliveryKey(d.campaign_lead_id, d.follow_up_id))
    );

    for (const lead of leads) {
      if (campaignLeadId && lead.id !== campaignLeadId) continue;
      if (lead.reply_received) continue;

      for (const followUp of followUps) {
        if (sentSet.has(deliveryKey(lead.id, followUp.id))) continue;
        if (!ignoreWaitingDays && !isFollowUpDue(lead.sent_at, followUp.waiting_days, now))
          continue;

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
  await syncThankYouDraftsBeforeFollowUps();

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

  const { maybeCompleteCampaign } = require('./campaignCompletionService');
  const campaigns = new Map(dueItems.map((item) => [item.campaignId, item.userId]));
  for (const [campaignId, userId] of campaigns) await maybeCompleteCampaign(userId, campaignId);

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
