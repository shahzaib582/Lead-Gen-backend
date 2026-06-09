/** @typedef {import('../services/notificationService').NotificationType} NotificationType */

/**
 * @param {Record<string, unknown>} row
 */
function toPublicNotification(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body ?? null,
    read: Boolean(row.read),
    readAt: row.read_at ?? null,
    campaignId: row.campaign_id ?? null,
    campaignLeadId: row.campaign_lead_id ?? null,
    meetingId: row.meeting_id ?? null,
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    createdAt: row.created_at,
  };
}

module.exports = { toPublicNotification };
