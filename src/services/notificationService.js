const supabase = require('../config/supabase');
const AppError = require('../utils/AppError');
const { parseLeadDataId } = require('../utils/leadDataId');
const { toPublicNotification } = require('../utils/notificationPublic');
const { publishNotificationEvent } = require('./notificationEventsPublisher');
const { isUserNotificationsEnabled } = require('./userNotificationPreferences');
const { sendWebPushForNotification } = require('./fcmPushService');
const logger = require('../utils/logger');

/** @typedef {'reply_received' | 'email_failed' | 'meeting_booked' | 'outreach_finished'} NotificationType */

const NOTIFICATION_TYPES = Object.freeze({
  reply_received: 'reply_received',
  email_failed: 'email_failed',
  meeting_booked: 'meeting_booked',
  outreach_finished: 'outreach_finished',
});

/**
 * @param {{
 *   userId: string,
 *   type: NotificationType,
 *   title: string,
 *   body?: string | null,
 *   campaignId?: string | null,
 *   campaignLeadId?: string | null,
 *   meetingId?: string | null,
 *   metadata?: Record<string, unknown>,
 * }} params
 */
async function createUserNotification(params) {
  const {
    userId,
    type,
    title,
    body = null,
    campaignId = null,
    campaignLeadId = null,
    meetingId = null,
    metadata = {},
  } = params;

  if (!userId || !type || !title) return null;

  const { data, error } = await supabase
    .from('notifications')
    .insert({
      user_id: userId,
      type,
      title: String(title).trim(),
      body: body ? String(body).trim() : null,
      campaign_id: campaignId,
      campaign_lead_id: campaignLeadId,
      meeting_id: meetingId,
      metadata,
    })
    .select()
    .single();

  if (error) {
    logger.warn('[Notifications] insert failed', { userId, type, error: error.message });
    return null;
  }

  const publicRow = toPublicNotification(data);

  if (await isUserNotificationsEnabled(userId)) {
    await publishNotificationEvent(userId, {
      type: 'notification',
      notification: publicRow,
    });
  }

  void sendWebPushForNotification(userId, publicRow);

  return publicRow;
}

async function listNotifications(userId, { page = 1, limit = 20, unreadOnly = false } = {}) {
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let q = supabase
    .from('notifications')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (unreadOnly) {
    q = q.eq('read', false);
  }

  const { data, error, count } = await q;
  if (error) throw new AppError(error.message || 'Failed to load notifications.', 500);

  const total = count ?? 0;
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  return {
    items: (data || []).map(toPublicNotification),
    pagination: { page, limit, total, totalPages },
  };
}

async function getUnreadCount(userId) {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('read', false);

  if (error) throw new AppError(error.message || 'Failed to count notifications.', 500);
  return { unreadCount: count ?? 0 };
}

async function markNotificationRead(userId, notificationId) {
  const { data, error } = await supabase
    .from('notifications')
    .update({ read: true, read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .eq('user_id', userId)
    .eq('read', false)
    .select()
    .maybeSingle();

  if (error) throw new AppError(error.message || 'Failed to update notification.', 500);
  if (!data) {
    const { data: existing } = await supabase
      .from('notifications')
      .select('*')
      .eq('id', notificationId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!existing) throw new AppError('Notification not found.', 404);
    return toPublicNotification(existing);
  }

  return toPublicNotification(data);
}

async function markAllNotificationsRead(userId) {
  const { error } = await supabase
    .from('notifications')
    .update({ read: true, read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('read', false);

  if (error) throw new AppError(error.message || 'Failed to mark notifications read.', 500);
  return getUnreadCount(userId);
}

async function notifyReplyReceived(userId, { campaignId, campaignLeadId, leadEmail }) {
  const email = leadEmail ? String(leadEmail).trim() : 'A lead';
  return createUserNotification({
    userId,
    type: NOTIFICATION_TYPES.reply_received,
    title: 'New reply',
    body: `${email} replied to your campaign email.`,
    campaignId,
    campaignLeadId,
    metadata: { leadEmail: leadEmail || null },
  });
}

async function notifyEmailFailed(userId, { campaignId, campaignLeadId, message }) {
  let leadEmail = null;
  const { data: campaignLead } = await supabase
    .from('campaign_leads')
    .select('lead_data_id')
    .eq('id', campaignLeadId)
    .eq('user_id', userId)
    .maybeSingle();

  if (campaignLead?.lead_data_id) {
    const { data: leadRow } = await supabase
      .from('leads_data')
      .select('email')
      .eq('id', parseLeadDataId(campaignLead.lead_data_id))
      .maybeSingle();
    if (leadRow?.email) leadEmail = leadRow.email;
  }

  const label = leadEmail || 'a lead';
  const detail = message ? ` ${String(message).slice(0, 200)}` : '';
  return createUserNotification({
    userId,
    type: NOTIFICATION_TYPES.email_failed,
    title: 'Email failed',
    body: `Could not send to ${label}.${detail}`,
    campaignId,
    campaignLeadId,
    metadata: { leadEmail, message: message || null },
  });
}

async function notifyMeetingBooked(userId, meeting) {
  const attendee = meeting.attendee_email ? String(meeting.attendee_email) : 'attendee';
  return createUserNotification({
    userId,
    type: NOTIFICATION_TYPES.meeting_booked,
    title: 'Meeting scheduled',
    body: `${meeting.title} with ${attendee}.`,
    campaignId: meeting.campaign_id,
    campaignLeadId: meeting.campaign_lead_id,
    meetingId: meeting.id,
    metadata: {
      startAt: meeting.start_at,
      endAt: meeting.end_at,
      attendeeEmail: meeting.attendee_email,
    },
  });
}

async function notifyOutreachFinished(userId, campaignId, result) {
  const { data: camp } = await supabase
    .from('campaigns')
    .select('name')
    .eq('id', campaignId)
    .eq('user_id', userId)
    .maybeSingle();

  const name = camp?.name || 'Campaign';
  const sent = result.sent ?? 0;
  const failed = result.sendFailed ?? 0;
  const skipped = result.sendSkipped ?? 0;
  let body = `Outreach finished for ${name}: ${sent} sent`;
  if (failed > 0) body += `, ${failed} failed`;
  if (skipped > 0) body += `, ${skipped} skipped`;
  if (result.dailyLimitReached) body += '. Daily send limit reached.';
  body += '.';

  return createUserNotification({
    userId,
    type: NOTIFICATION_TYPES.outreach_finished,
    title: 'Outreach complete',
    body,
    campaignId,
    metadata: {
      sent,
      sendFailed: failed,
      sendSkipped: skipped,
      templatesGenerated: result.templatesGenerated ?? 0,
      templateFailures: result.templateFailures ?? 0,
      dailyLimitReached: Boolean(result.dailyLimitReached),
    },
  });
}

module.exports = {
  NOTIFICATION_TYPES,
  createUserNotification,
  listNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  notifyReplyReceived,
  notifyEmailFailed,
  notifyMeetingBooked,
  notifyOutreachFinished,
};
