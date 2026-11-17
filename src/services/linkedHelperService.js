const db = require('../config/supabase');
const AppError = require('../utils/AppError');
const client = require('./linkedHelperClient');

async function owner(userId, campaignId) {
  const { data, error } = await db
    .from('campaigns')
    .select('id')
    .eq('id', campaignId)
    .eq('user_id', userId)
    .single();
  if (error || !data) throw new AppError('Campaign not found.', 404);
}
function check(error) {
  if (error) throw new AppError('Linked Helper storage operation failed.', 500);
}
async function configuration(userId, campaignId) {
  await owner(userId, campaignId);
  const { data, error } = await db
    .from('linked_helper_campaigns')
    .select('campaign_id,updated_at')
    .eq('campaign_id', campaignId)
    .eq('user_id', userId)
    .maybeSingle();
  check(error);
  return { configured: !!data, updated_at: data?.updated_at || null };
}
async function configure(userId, campaignId, webhook) {
  await owner(userId, campaignId);
  const encrypted = client.encrypt(client.validateWebhook(webhook));
  const { error } = await db.from('linked_helper_campaigns').upsert(
    {
      campaign_id: campaignId,
      user_id: userId,
      webhook_encrypted: encrypted,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'campaign_id' }
  );
  check(error);
  return { configured: true };
}
async function enrollLeads(userId, campaignId, leads) {
  await owner(userId, campaignId);
  const { data: config, error: configError } = await db
    .from('linked_helper_campaigns')
    .select('webhook_encrypted')
    .eq('campaign_id', campaignId)
    .eq('user_id', userId)
    .maybeSingle();
  check(configError);
  if (!config) throw new AppError('Configure the Linked Helper campaign webhook first.', 409);
  const webhook = client.validateWebhook(client.decrypt(config.webhook_encrypted));
  const ids = leads.map((l) => l.campaign_lead_id);
  const { data: rows, error } = await db
    .from('campaign_leads')
    .select('id,lead_data_id')
    .eq('campaign_id', campaignId)
    .eq('user_id', userId)
    .in('id', ids);
  check(error);
  if (rows.length !== new Set(ids).size || ids.some((id) => !rows.some((row) => row.id === id)))
    throw new AppError('One or more campaign leads were not found.', 404);
  const { data: profiles, error: profileError } = await db
    .from('leads_data')
    .select('id,linkedin')
    .in(
      'id',
      rows.map((l) => l.lead_data_id)
    );
  check(profileError);
  // Ownership is batch-validated above; invalid profile URLs are isolated per lead.
  const prepared = leads.map((lead) => {
    const row = rows.find((r) => r.id === lead.campaign_lead_id);
    const profile = profiles.find((p) => String(p.id) === String(row.lead_data_id));
    try {
      return { ...lead, profile_url: client.profileUrl(profile?.linkedin) };
    } catch (err) {
      if (err.statusCode !== 400) throw err;
      return { ...lead, invalid: true };
    }
  });
  const results = [];
  const seenProfiles = new Set();
  for (const lead of prepared) {
    if (lead.invalid) {
      results.push({
        campaign_lead_id: lead.campaign_lead_id,
        status: 'invalid',
        message: 'Add a valid HTTPS LinkedIn profile URL before retrying.',
      });
      continue;
    }
    if (seenProfiles.has(lead.profile_url)) {
      results.push({ campaign_lead_id: lead.campaign_lead_id, status: 'already_submitted' });
      continue;
    }
    seenProfiles.add(lead.profile_url);
    // Durable unique claim prevents concurrent requests and repeated button clicks from enrolling twice.
    let { data: claim, error: claimError } = await db
      .from('linked_helper_enrollments')
      .insert({
        campaign_id: campaignId,
        user_id: userId,
        campaign_lead_id: lead.campaign_lead_id,
        profile_url: lead.profile_url,
        status: 'submitting',
      })
      .select('id')
      .single();
    if (claimError?.code === '23505' && lead.retry_rejected === true) {
      // Atomic compare-and-set: concurrent retries cannot both take a rejected claim.
      const retry = await db
        .from('linked_helper_enrollments')
        .update({
          status: 'submitting',
          http_status: null,
          campaign_lead_id: lead.campaign_lead_id,
          updated_at: new Date().toISOString(),
        })
        .eq('campaign_id', campaignId)
        .eq('user_id', userId)
        .eq('profile_url', lead.profile_url)
        .eq('status', 'rejected')
        .select('id')
        .maybeSingle();
      check(retry.error);
      if (retry.data) {
        claim = retry.data;
        claimError = null;
      }
    }
    if (claimError?.code === '23505') {
      results.push({ campaign_lead_id: lead.campaign_lead_id, status: 'already_submitted' });
      continue;
    }
    check(claimError);
    const outcome = await client.enroll(webhook, lead.profile_url, lead.message);
    const { error: updateError } = await db
      .from('linked_helper_enrollments')
      .update({ ...outcome, updated_at: new Date().toISOString() })
      .eq('id', claim.id)
      .eq('user_id', userId);
    check(updateError);
    results.push({ campaign_lead_id: lead.campaign_lead_id, ...outcome });
  }
  return { results };
}
async function listEnrollments(userId, campaignId, page, limit) {
  await owner(userId, campaignId);
  const { data, error, count } = await db
    .from('linked_helper_enrollments')
    .select('id,campaign_lead_id,status,http_status,created_at,updated_at', { count: 'exact' })
    .eq('campaign_id', campaignId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  check(error);
  return { enrollments: data, total: count, page, limit };
}
async function connectionSummary(userId) {
  const { count, error } = await db
    .from('linked_helper_campaigns')
    .select('campaign_id', { count: 'exact', head: true })
    .eq('user_id', userId);
  check(error);
  return { configured_campaigns: count || 0, workflow_status: 'unverified' };
}
module.exports = { connectionSummary, configuration, configure, enrollLeads, listEnrollments };
