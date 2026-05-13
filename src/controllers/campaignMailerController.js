const { validationResult } = require('express-validator');
const campaignMailerService = require('../services/campaignMailerService');
const googleAuthService = require('../services/googleAuthService');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { successResponse } = require('../utils/response');

function handleValidationErrors(req) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const messages = errors
      .array()
      .map((e) => e.msg)
      .join(', ');
    throw new AppError(messages, 422);
  }
}

// ─── POST /campaigns/:id/leads/send-emails ────────────────────────────────────
//
// Sends the AI-generated mail_template to every pending campaign lead that has
// one, applying:
//   • A random delay (10s – 60s, configurable) between each send
//   • A hard cap of 500 emails per calendar day (UTC) across all campaigns
//
// Token resolution order:
//   1. req.body.access_token  — explicitly passed in the request body
//   2. DB lookup via getValidGoogleAccessToken(userId) — auto-refreshes if expired
//      Works for BOTH email/password users AND Google-login users, as long as
//      the user has completed the Google OAuth flow at least once (GET /api/auth/google).
//
// Request body (all optional):
//   campaign_lead_id  — UUID: if provided, only send to that single lead
//   access_token      — Google OAuth2 token; if omitted, fetched from DB automatically

async function sendEmails(req, res, next) {
  try {
    handleValidationErrors(req);

    const campaignId = req.params.id;
    const userId = req.user.id;
    const campaignLeadId = req.body.campaign_lead_id || null;

    // ── Resolve Google access token ───────────────────────────────────────────
    // Priority 1: explicit token in request body
    let accessToken = req.body.access_token || null;

    // Priority 2: fetch from DB (works for email/password users who have linked Google)
    if (!accessToken) {
      try {
        accessToken = await googleAuthService.getValidGoogleAccessToken(userId);
      } catch {
        // No linked Google account — give the user a clear, actionable message
        throw new AppError(
          'No Google account linked. Please visit GET /api/auth/google to connect your Gmail account before sending emails.',
          400
        );
      }
    }

    logger.info('Campaign email send requested', {
      campaignId,
      userId,
      campaignLeadId,
      hasToken: !!accessToken,
    });

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
