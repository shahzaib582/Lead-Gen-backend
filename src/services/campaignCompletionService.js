const supabase = require('../config/supabase');
const { fetchAllRows } = require('../utils/fetchAllRows');
const AppError = require('../utils/AppError');

async function maybeCompleteCampaign(userId, campaignId) {
  const { data: campaign, error } = await supabase
    .from('campaigns')
    .select('status, run_mode')
    .eq('id', campaignId)
    .eq('user_id', userId)
    .single();
  if (error) throw new AppError('Failed to check campaign completion.', 503);
  if (campaign.status !== 'active' || campaign.run_mode !== 'auto') return false;
  const leads = await fetchAllRows(() =>
    supabase
      .from('campaign_leads')
      .select('id, status, reply_received')
      .eq('campaign_id', campaignId)
      .eq('user_id', userId)
      .order('id')
  );
  if (!leads.length) return false;
  // Failed initial sends still require attention; never hide them as completed.
  if (leads.some((lead) => ['pending', 'template_generated', 'failed'].includes(lead.status)))
    return false;
  const definitions = await fetchAllRows(() =>
    supabase
      .from('campaign_follow_ups')
      .select('id, body_template')
      .eq('campaign_id', campaignId)
      .order('id')
  );
  const usable = definitions.filter((row) => row.body_template?.trim());
  for (const lead of leads.filter((row) => row.status === 'sent' && !row.reply_received)) {
    const deliveries = await fetchAllRows(() =>
      supabase
        .from('campaign_lead_follow_ups')
        .select('id, follow_up_id, status')
        .eq('campaign_lead_id', lead.id)
        .order('id')
    );
    if (
      usable.some(
        (step) => !deliveries.some((row) => row.follow_up_id === step.id && row.status === 'sent')
      )
    )
      return false;
  }
  const { error: updateError } = await supabase
    .from('campaigns')
    .update({ status: 'completed' })
    .eq('id', campaignId)
    .eq('user_id', userId)
    .eq('status', 'active');
  if (updateError) throw new AppError('Failed to complete campaign.', 503);
  return true;
}
module.exports = { maybeCompleteCampaign };
