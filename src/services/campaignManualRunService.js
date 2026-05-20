const supabase = require('../config/supabase');
const AppError = require('../utils/AppError');
const googleAuthService = require('./googleAuthService');
const { generateMailTemplates } = require('./mailTemplateService');
const { sendCampaignEmails } = require('./campaignMailerService');
const { assertCampaignActiveForSend } = require('./campaignSendRules');
const { randomDelayMs } = require('../config/mailDelay');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fast checks before starting background outreach (HTTP returns immediately after this).
 * @returns {Promise<{ leadCount: number }>}
 */
async function validateManualCampaignRunStart(userId, campaignId) {
  const { data: campaign, error: campError } = await supabase
    .from('campaigns')
    .select('id, status, run_mode')
    .eq('id', campaignId)
    .eq('user_id', userId)
    .single();

  if (campError || !campaign) {
    throw new AppError('Campaign not found.', 404);
  }

  if (campaign.run_mode !== 'manual') {
    throw new AppError(
      'This endpoint is for manual campaigns only. Auto campaigns process leads automatically when active.',
      400,
      'CAMPAIGN_NOT_MANUAL'
    );
  }

  assertCampaignActiveForSend(campaign);

  const { data: leads, error: leadsError } = await supabase
    .from('campaign_leads')
    .select('id')
    .eq('campaign_id', campaignId)
    .eq('user_id', userId)
    .in('status', ['pending', 'template_generated']);

  if (leadsError) {
    throw new AppError('Failed to fetch campaign leads.', 500);
  }

  if (!leads || leads.length === 0) {
    throw new AppError('No pending leads to process.', 404);
  }

  try {
    await googleAuthService.getValidGoogleAccessToken(userId);
  } catch (err) {
    throw new AppError(
      err.message ||
        'No Google account linked. Visit GET /api/auth/google to connect Gmail before sending.',
      err.statusCode || 400,
      err.code || 'GOOGLE_NOT_LINKED'
    );
  }

  return { leadCount: leads.length };
}

/**
 * Manual active campaigns: generate templates then send Gmail for each pending lead, one at a time.
 * Auto campaigns use workers on bulk add; this endpoint returns 400 for them.
 */
async function runManualCampaignOutreach(userId, campaignId) {
  const { data: leads, error: leadsError } = await supabase
    .from('campaign_leads')
    .select('id, status')
    .eq('campaign_id', campaignId)
    .eq('user_id', userId)
    .in('status', ['pending', 'template_generated'])
    .order('created_at', { ascending: true });

  if (leadsError) {
    throw new AppError('Failed to fetch campaign leads.', 500);
  }

  if (!leads || leads.length === 0) {
    return {
      examined: 0,
      templatesGenerated: 0,
      templateFailures: 0,
      sent: 0,
      sendFailed: 0,
      sendSkipped: 0,
      dailyLimitReached: false,
      results: [],
    };
  }

  const accessToken = await googleAuthService.getValidGoogleAccessToken(userId);

  const summary = {
    examined: leads.length,
    templatesGenerated: 0,
    templateFailures: 0,
    sent: 0,
    sendFailed: 0,
    sendSkipped: 0,
    dailyLimitReached: false,
    results: [],
  };

  for (let i = 0; i < leads.length; i++) {
    const cl = leads[i];
    const leadResult = { campaignLeadId: cl.id, initialStatus: cl.status };

    if (cl.status === 'pending') {
      try {
        const gen = await generateMailTemplates(userId, campaignId, cl.id, {
          skipMailKickoff: true,
        });
        summary.templatesGenerated += gen.processed;
        summary.templateFailures += gen.failed;
        leadResult.template = gen.results[0] || null;
      } catch (genErr) {
        if (genErr.statusCode !== 404) {
          throw genErr;
        }
        leadResult.template = { status: 'skipped', reason: genErr.message };
      }
    } else {
      leadResult.template = { status: 'already_generated' };
    }

    try {
      const sendSummary = await sendCampaignEmails(userId, campaignId, accessToken, cl.id);
      summary.sent += sendSummary.sent;
      summary.sendFailed += sendSummary.failed;
      summary.sendSkipped += sendSummary.skipped;
      leadResult.send = sendSummary.results?.[0] || {
        sent: sendSummary.sent,
        failed: sendSummary.failed,
        skipped: sendSummary.skipped,
      };

      if (sendSummary.dailyLimitReached) {
        summary.dailyLimitReached = true;
        summary.results.push(leadResult);
        break;
      }
    } catch (sendErr) {
      if (sendErr.statusCode === 404) {
        leadResult.send = { status: 'skipped', reason: sendErr.message };
      } else {
        throw sendErr;
      }
    }

    summary.results.push(leadResult);

    if (i < leads.length - 1 && !summary.dailyLimitReached) {
      await sleep(randomDelayMs());
    }
  }

  return summary;
}

module.exports = {
  validateManualCampaignRunStart,
  runManualCampaignOutreach,
};
