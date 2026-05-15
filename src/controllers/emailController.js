const emailService = require('../services/emailService');
const googleAuthService = require('../services/googleAuthService');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { successResponse } = require('../utils/response');

// ─── POST /emails/send ───────────────────────────────────────────────────────
// Send a custom email via Gmail API using the user's Google OAuth access token.

async function sendEmail(req, res, next) {
  try {
    const { to, subject, body, html } = req.body;
    const userId = req.user.id;

    // Get the user's valid Google access token (auto-refreshes if expired)
    const accessToken = await googleAuthService.getValidGoogleAccessToken(userId);

    if (!accessToken) {
      throw new AppError(
        'No Google access token found. Please authenticate with Google first.',
        404
      );
    }

    // Pass the Google access token to the service so it sends via Gmail API
    const emailInfo = await emailService.sendCustomEmail(to, subject, body, html, accessToken);

    logger.info('Custom email sent via Gmail API', {
      userId,
      to,
      subject,
      messageId: emailInfo.messageId,
    });

    return successResponse(res, 200, 'Email sent successfully.', {
      messageId: emailInfo.messageId,
      to,
      subject,
      accessTokenUsed: true,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  sendEmail,
};
