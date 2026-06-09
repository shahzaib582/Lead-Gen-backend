const supabase = require('../config/supabase');
const AppError = require('../utils/AppError');
const { findDueFollowUpItems } = require('./followUpSchedulerService');
const { sendFollowUpEmail } = require('./campaignFollowUpMailerService');

async function insertTesterLead(payload) {
  const { data, error } = await supabase.from('leads_data').insert(payload).select('*').single();
  if (!error) return data;

  // Fallback for out-of-sync bigint sequence in some environments.
  if (error.code !== '23505') {
    throw new AppError(error.message || 'Failed to create test lead.', 500);
  }

  const { data: maxRows, error: maxErr } = await supabase
    .from('leads_data')
    .select('id')
    .order('id', { ascending: false })
    .limit(1);

  if (maxErr) {
    throw new AppError(maxErr.message || 'Failed to create test lead.', 500);
  }

  const maxId = Number(maxRows?.[0]?.id || 0);
  const { data: retryData, error: retryErr } = await supabase
    .from('leads_data')
    .insert({ ...payload, id: maxId + 1 })
    .select('*')
    .single();

  if (retryErr) {
    throw new AppError(retryErr.message || 'Failed to create test lead.', 500);
  }
  return retryData;
}

async function createTesterLead({ email, fullName, firstName, company, title }) {
  const lead = await insertTesterLead({
    email: String(email).trim().toLowerCase(),
    fullName: fullName ? String(fullName).trim() : null,
    firstName: firstName ? String(firstName).trim() : null,
    company: company ? String(company).trim() : null,
    title: title ? String(title).trim() : null,
    emailStatus: 'Verify',
    outreachStatus: 'new',
  });

  return { lead };
}

async function runTesterFollowUps({
  userId,
  campaignId,
  ignoreWaitingDays = true,
  campaignLeadId = null,
  followUpId = null,
}) {
  const dueItems = await findDueFollowUpItems(new Date(), {
    userId,
    campaignId,
    ignoreWaitingDays,
    campaignLeadId,
    followUpId,
  });

  const summary = {
    examined: dueItems.length,
    sent: 0,
    failed: 0,
    skipped: 0,
    results: [],
  };

  for (const item of dueItems) {
    try {
      const result = await sendFollowUpEmail({
        userId: item.userId,
        campaignId: item.campaignId,
        campaignLeadId: item.campaignLeadId,
        followUpId: item.followUpId,
      });

      summary.results.push({ ...item, ...result });
      if (result.status === 'sent') summary.sent += 1;
      else if (result.status === 'failed') summary.failed += 1;
      else summary.skipped += 1;
    } catch (err) {
      summary.failed += 1;
      summary.results.push({
        ...item,
        status: 'failed',
        error: err.message,
      });
    }
  }

  return summary;
}

module.exports = {
  createTesterLead,
  runTesterFollowUps,
};
