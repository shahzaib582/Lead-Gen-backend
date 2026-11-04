const supabase = require('../config/supabase');
const { fetchAllRows } = require('../utils/fetchAllRows');
const { ensureMailTemplateJob } = require('../jobs/mailTemplateJob');
const { maybeKickoffCampaignMailChain } = require('./campaignMailKickoffService');
const { maybeCompleteCampaign } = require('./campaignCompletionService');

// Repair DB→queue gaps left by process crashes, queue outages or activation races.
async function recoverCampaigns() {
  const campaigns = await fetchAllRows(() =>
    supabase
      .from('campaigns')
      .select('id, user_id')
      .eq('status', 'active')
      .eq('run_mode', 'auto')
      .order('id')
  );
  for (const campaign of campaigns) {
    const leads = await fetchAllRows(() =>
      supabase
        .from('campaign_leads')
        .select('id, status, mail_template')
        .eq('campaign_id', campaign.id)
        .in('status', ['pending', 'template_generated'])
        .order('id')
    );
    for (const lead of leads.filter((row) => row.status === 'pending')) {
      await ensureMailTemplateJob({
        userId: campaign.user_id,
        campaignId: campaign.id,
        campaignLeadId: lead.id,
      });
    }
    const ready = leads.find(
      (row) => row.status === 'template_generated' && row.mail_template?.trim()
    );
    if (ready)
      await maybeKickoffCampaignMailChain({
        userId: campaign.user_id,
        campaignId: campaign.id,
        campaignLeadId: ready.id,
      });
    if (!leads.length) await maybeCompleteCampaign(campaign.user_id, campaign.id);
  }
}
module.exports = { recoverCampaigns };
