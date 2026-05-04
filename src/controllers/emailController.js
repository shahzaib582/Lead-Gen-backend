const { validationResult } = require('express-validator');
const emailService = require('../services/emailService');
const googleAuthService = require('../services/googleAuthService');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

function handleValidationErrors(req) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const messages = errors.array().map((e) => e.msg).join(', ');
    throw new AppError(messages, 422);
  }
}

// ─── POST /emails/send ───────────────────────────────────────────────────────
// Send a custom email using the user's Google access token

async function sendEmail(req, res, next) {
  try {
    handleValidationErrors(req);

    const { to, subject, body, html } = req.body;
    const userId = req.user.id;

    // Get the user's valid Google access token (refreshes if expired)
    const accessToken = await googleAuthService.getValidGoogleAccessToken(userId);

    if (!accessToken) {
      throw new AppError('No Google access token found. Please authenticate with Google first.', 404);
    }

    // Send the email using the custom email service
    const emailInfo = await emailService.sendCustomEmail(to, subject, body, html);

    logger.info('Custom email sent via Google auth', {
      userId,
      to,
      subject,
      messageId: emailInfo.messageId,
    });

    return res.status(200).json({
      success: true,
      message: 'Email sent successfully.',
      data: {
        messageId: emailInfo.messageId,
        to,
        subject,
        accessTokenUsed: true,
      },
    });

  } catch (err) {
    next(err);
  }
}

module.exports = {
  sendEmail,
};