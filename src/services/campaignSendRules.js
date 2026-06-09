const AppError = require('../utils/AppError');

/**
 * Initial and follow-up outbound mail may only run while the campaign is active.
 * @param {{ status?: string } | null | undefined} campaign
 */
function assertCampaignActiveForSend(campaign) {
  if (!campaign || campaign.status !== 'active') {
    const status = campaign?.status || 'unknown';
    throw new AppError(
      `Cannot send emails while campaign status is "${status}". Set status to active first.`,
      400,
      'CAMPAIGN_NOT_ACTIVE'
    );
  }
}

/**
 * @param {{ status?: string } | null | undefined} campaign
 * @returns {boolean}
 */
function isCampaignActiveForSend(campaign) {
  return Boolean(campaign && campaign.status === 'active');
}

module.exports = { assertCampaignActiveForSend, isCampaignActiveForSend };
