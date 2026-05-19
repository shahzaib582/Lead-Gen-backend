#!/usr/bin/env node
/**
 * Force-send all follow-ups for one campaign (ignores waiting_days / due date).
 * Usage: node scripts/force-campaign-follow-ups.js [campaignId]
 */
require('dotenv').config();

const supabase = require('../src/config/supabase');
const { sendFollowUpEmail } = require('../src/services/campaignFollowUpMailerService');

const CAMPAIGN_ID = process.argv[2] || '42d9332a-e9d8-4609-aad2-fe53cc7bd889';

function deliveryKey(campaignLeadId, followUpId) {
  return `${campaignLeadId}:${followUpId}`;
}

async function main() {
  const { data: campaign, error: campErr } = await supabase
    .from('campaigns')
    .select('id, user_id, status, name')
    .eq('id', CAMPAIGN_ID)
    .single();

  if (campErr || !campaign) {
    console.error('Campaign not found:', CAMPAIGN_ID);
    process.exit(1);
  }

  console.log('Campaign:', campaign.name || campaign.id, '| status:', campaign.status);

  const { data: followUps, error: fuErr } = await supabase
    .from('campaign_follow_ups')
    .select('id, name, waiting_days, body_template')
    .eq('campaign_id', CAMPAIGN_ID)
    .not('body_template', 'is', null)
    .neq('body_template', '')
    .order('waiting_days', { ascending: true });

  if (fuErr) {
    console.error('Failed to load follow-ups:', fuErr.message);
    process.exit(1);
  }

  if (!followUps?.length) {
    console.log('No follow-ups with body_template on this campaign.');
    process.exit(0);
  }

  const { data: leads, error: leadsErr } = await supabase
    .from('campaign_leads')
    .select('id, sent_at, status')
    .eq('campaign_id', CAMPAIGN_ID)
    .eq('user_id', campaign.user_id)
    .eq('status', 'sent')
    .not('sent_at', 'is', null);

  if (leadsErr) {
    console.error('Failed to load sent leads:', leadsErr.message);
    process.exit(1);
  }

  if (!leads?.length) {
    console.log('No campaign_leads with status=sent and sent_at set.');
    process.exit(0);
  }

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

  const summary = { sent: 0, failed: 0, skipped: 0, results: [] };

  for (const lead of leads) {
    for (const followUp of followUps) {
      if (sentSet.has(deliveryKey(lead.id, followUp.id))) {
        summary.skipped++;
        summary.results.push({
          campaignLeadId: lead.id,
          followUpId: followUp.id,
          followUpName: followUp.name,
          status: 'skipped',
          reason: 'already_sent',
        });
        continue;
      }

      console.log(`Sending follow-up "${followUp.name}" for lead ${lead.id} (waiting_days=${followUp.waiting_days} ignored)`);

      const result = await sendFollowUpEmail({
        userId: campaign.user_id,
        campaignId: CAMPAIGN_ID,
        campaignLeadId: lead.id,
        followUpId: followUp.id,
      });

      summary.results.push({
        campaignLeadId: lead.id,
        followUpId: followUp.id,
        followUpName: followUp.name,
        ...result,
      });

      if (result.status === 'sent') summary.sent++;
      else if (result.status === 'failed') summary.failed++;
      else summary.skipped++;
    }
  }

  console.log('\nDone:', JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
