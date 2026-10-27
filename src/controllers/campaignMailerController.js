const campaignMailerService = require('../services/campaignMailerService');
const googleAuthService = require('../services/googleAuthService');
const AppError = require('../utils/AppError');
const { successResponse } = require('../utils/response');

// ─── POST /campaigns/:id/leads/send-emails ────────────────────────────────────
//
// Sends the AI-generated mail_template to every pending campaign lead that has
// one, applying:
//   • A random delay between MAIL_DELAY_MIN_MS and MAIL_DELAY_MAX_MS (defaults 3–5 minutes)
//   • A hard cap of 500 emails per calendar day (UTC) across all campaigns
//
// Gmail token is always loaded from the linked google_accounts row (auto-refreshed).
// Request body (optional): campaign_lead_id — UUID to send to one lead only.

async function sendEmails(req, res, next) {
  try {
    const campaignId = req.params.id;
    const userId = req.user.id;
    const campaignLeadId = req.body.campaign_lead_id || null;

    let accessToken;
    try {
      accessToken = await googleAuthService.getValidGoogleAccessToken(userId);
    } catch (err) {
      const code = err.code || 'GOOGLE_NOT_LINKED';
      throw new AppError(
        err.message ||
          'No Google account linked. Visit GET /api/auth/google to connect Gmail before sending.',
        err.statusCode || 400,
        code
      );
    }

    const result = await campaignMailerService.sendCampaignEmails(
      userId,
      campaignId,
      accessToken,
      campaignLeadId
    );

    // Build a human-readable summary message
    let message;
    if (result.dailyLimitReached && result.sent === 0) {
      message = `Daily limit of ${result.dailyLimit} emails already reached. No emails sent today.`;
    } else {
      message = `${result.sent} email(s) sent, ${result.failed} failed, ${result.skipped} skipped.`;
      if (result.dailyLimitReached) {
        message += ` Daily limit of ${result.dailyLimit} reached (${result.totalSentToday} sent today).`;
      }
    }

    return successResponse(res, 200, message, result);
  } catch (err) {
    next(err);
  }
}

module.exports = { sendEmails };
