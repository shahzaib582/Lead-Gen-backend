const crypto = require('crypto');
const supabase = require('../config/supabase');
const logger = require('../utils/logger');
const { fetchCalendlyResource } = require('./calendlyApiClient');
const calendlyAuthService = require('./calendlyAuthService');

/**
 * Verify Calendly-Webhook-Signature header (t=timestamp,v1=hex).
 * @param {Buffer|string} rawBody
 * @param {string|undefined} signatureHeader
 * @param {string} signingKey
 */
function verifyCalendlyWebhookSignature(rawBody, signatureHeader, signingKey) {
  if (!signatureHeader || !signingKey) return false;

  const parts = {};
  for (const segment of String(signatureHeader).split(',')) {
    const eq = segment.indexOf('=');
    if (eq === -1) continue;
    parts[segment.slice(0, eq).trim()] = segment.slice(eq + 1).trim();
  }

  const { t, v1 } = parts;
  if (!t || !v1) return false;

  const bodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
  const signedPayload = `${t}.${bodyStr}`;
  const expected = crypto.createHmac('sha256', signingKey).update(signedPayload).digest('hex');

  try {
    const a = Buffer.from(v1, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

async function recordWebhookEvent({ dedupeKey, eventType, inviteeUri, payload }) {
  const { error } = await supabase.from('calendly_webhook_events').insert({
    dedupe_key: dedupeKey,
    event_type: eventType,
    invitee_uri: inviteeUri || null,
    payload: payload || null,
  });

  if (error?.code === '23505') {
    return { duplicate: true };
  }
  if (error) {
    logger.error('[CalendlyWebhook] failed to record event', { error: error.message });
  }
  return { duplicate: false };
}

async function fetchScheduledEvent(accessToken, scheduledEventUri, inviteePayload) {
  let scheduledEvent = inviteePayload?.scheduled_event || null;
  if (scheduledEvent?.start_time && scheduledEvent?.end_time) {
    return scheduledEvent;
  }
  if (!scheduledEventUri || !accessToken) return null;
  return fetchCalendlyResource(accessToken, scheduledEventUri);
}

/**
 * Resolve platform user + campaign context from UTM tracking or invitee email.
 */
async function resolveBookingContext({ tracking, inviteeEmail, platformUserId }) {
  const campaignLeadId = tracking?.utm_content ? String(tracking.utm_content).trim() : null;

  if (campaignLeadId) {
    let leadQuery = supabase
      .from('campaign_leads')
      .select('id, user_id, campaign_id')
      .eq('id', campaignLeadId);

    if (platformUserId) {
      leadQuery = leadQuery.eq('user_id', platformUserId);
    }

    const { data: lead } = await leadQuery.maybeSingle();

    if (lead) {
      return {
        userId: lead.user_id,
        campaignId: lead.campaign_id,
        campaignLeadId: lead.id,
      };
    }
  }

  if (platformUserId) {
    const email = inviteeEmail ? String(inviteeEmail).trim().toLowerCase() : null;
    if (email) {
      const { data: leadDataRows } = await supabase
        .from('leads_data')
        .select('id')
        .eq('email', email)
        .limit(20);

      if (leadDataRows?.length) {
        const leadDataIds = leadDataRows.map((r) => String(r.id));
        const { data: campaignLeads } = await supabase
          .from('campaign_leads')
          .select('id, user_id, campaign_id, created_at')
          .eq('user_id', platformUserId)
          .in('lead_data_id', leadDataIds)
          .eq('status', 'sent')
          .order('created_at', { ascending: false })
          .limit(1);

        const row = campaignLeads?.[0];
        if (row) {
          return {
            userId: row.user_id,
            campaignId: row.campaign_id,
            campaignLeadId: row.id,
          };
        }
      }
    }

    return { userId: platformUserId, campaignId: null, campaignLeadId: null };
  }

  const email = inviteeEmail ? String(inviteeEmail).trim().toLowerCase() : null;
  if (!email) return null;

  const { data: leadDataRows } = await supabase
    .from('leads_data')
    .select('id')
    .eq('email', email)
    .limit(20);

  if (!leadDataRows?.length) return null;

  const leadDataIds = leadDataRows.map((r) => String(r.id));

  const { data: campaignLeads } = await supabase
    .from('campaign_leads')
    .select('id, user_id, campaign_id, created_at')
    .in('lead_data_id', leadDataIds)
    .eq('status', 'sent')
    .order('created_at', { ascending: false })
    .limit(1);

  const row = campaignLeads?.[0];
  if (!row) return null;

  return {
    userId: row.user_id,
    campaignId: row.campaign_id,
    campaignLeadId: row.id,
  };
}

async function createMeetingFromInvitee({
  userId,
  campaignId,
  campaignLeadId,
  invitee,
  scheduledEvent,
  inviteeUri,
  scheduledEventUri,
}) {
  const startAt = scheduledEvent?.start_time;
  const endAt = scheduledEvent?.end_time;
  if (!startAt || !endAt) {
    throw new Error('Scheduled event missing start_time or end_time.');
  }

  const title =
    scheduledEvent?.name ||
    (invitee?.name ? `Meeting with ${invitee.name}` : 'Calendly meeting');

  const location = scheduledEvent?.location;
  let meetLink = null;
  if (location?.join_url) meetLink = location.join_url;
  else if (location?.location && /^https?:\/\//i.test(location.location)) {
    meetLink = location.location;
  }

  const attendeeEmail = invitee?.email ? String(invitee.email).trim().toLowerCase() : null;

  const { data: existing } = await supabase
    .from('meetings')
    .select('id')
    .eq('calendly_invitee_uri', inviteeUri)
    .maybeSingle();

  if (existing) {
    return { meeting: existing, created: false };
  }

  const { data: row, error } = await supabase
    .from('meetings')
    .insert({
      user_id: userId,
      campaign_id: campaignId || null,
      campaign_lead_id: campaignLeadId || null,
      title: String(title).trim(),
      description: scheduledEvent?.meeting_notes_plain || null,
      attendee_email: attendeeEmail,
      start_at: new Date(startAt).toISOString(),
      end_at: new Date(endAt).toISOString(),
      meet_link: meetLink,
      calendly_invitee_uri: inviteeUri,
      calendly_scheduled_event_uri: scheduledEventUri || null,
      status: 'scheduled',
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      const { data: dup } = await supabase
        .from('meetings')
        .select('*')
        .eq('calendly_invitee_uri', inviteeUri)
        .maybeSingle();
      return { meeting: dup, created: false };
    }
    throw new Error(error.message || 'Failed to create meeting.');
  }

  const { notifyMeetingBooked } = require('./notificationService');
  void notifyMeetingBooked(userId, row);

  return { meeting: row, created: true };
}

async function handleInviteeCreated(body, { platformUserId } = {}) {
  const invitee = body?.payload;
  const inviteeUri = invitee?.uri ? String(invitee.uri) : null;
  if (!inviteeUri) {
    return { handled: false, reason: 'missing_invitee_uri' };
  }

  const dedupeKey = `invitee.created:${inviteeUri}`;
  const recorded = await recordWebhookEvent({
    dedupeKey,
    eventType: 'invitee.created',
    inviteeUri,
    payload: invitee,
  });
  if (recorded.duplicate) {
    return { handled: true, duplicate: true };
  }

  const tracking = invitee.tracking || {};
  const context = await resolveBookingContext({
    tracking,
    inviteeEmail: invitee.email,
    platformUserId,
  });

  if (!context?.userId) {
    logger.warn('[CalendlyWebhook] Could not resolve user for booking', {
      inviteeEmail: invitee.email,
      utm_content: tracking.utm_content,
    });
    return { handled: true, reason: 'user_not_resolved' };
  }

  const scheduledEventUri = invitee.event ? String(invitee.event) : null;

  let accessToken;
  try {
    accessToken = await calendlyAuthService.getValidAccessToken(context.userId);
  } catch (err) {
    logger.warn('[CalendlyWebhook] No OAuth token for user — trying platform PAT fallback', {
      userId: context.userId,
      error: err.message,
    });
    accessToken = process.env.CALENDLY_PERSONAL_ACCESS_TOKEN || null;
  }

  const scheduledEvent = await fetchScheduledEvent(accessToken, scheduledEventUri, invitee);

  if (!scheduledEvent?.start_time || !scheduledEvent?.end_time) {
    logger.warn('[CalendlyWebhook] Missing event times', {
      scheduledEventUri,
      userId: context.userId,
    });
    return { handled: true, reason: 'missing_event_times' };
  }

  const result = await createMeetingFromInvitee({
    userId: context.userId,
    campaignId: context.campaignId,
    campaignLeadId: context.campaignLeadId,
    invitee,
    scheduledEvent,
    inviteeUri,
    scheduledEventUri,
  });

  logger.info('[CalendlyWebhook] Meeting recorded from invitee.created', {
    meetingId: result.meeting?.id,
    created: result.created,
    userId: context.userId,
    campaignLeadId: context.campaignLeadId,
  });

  return { handled: true, created: result.created, meetingId: result.meeting?.id };
}

async function handleInviteeCanceled(body) {
  const invitee = body?.payload;
  const inviteeUri = invitee?.uri ? String(invitee.uri) : null;
  if (!inviteeUri) {
    return { handled: false, reason: 'missing_invitee_uri' };
  }

  const dedupeKey = `invitee.canceled:${inviteeUri}:${invitee.updated_at || ''}`;
  const recorded = await recordWebhookEvent({
    dedupeKey,
    eventType: 'invitee.canceled',
    inviteeUri,
    payload: invitee,
  });
  if (recorded.duplicate) {
    return { handled: true, duplicate: true };
  }

  const { data: meeting } = await supabase
    .from('meetings')
    .select('id, user_id, status')
    .eq('calendly_invitee_uri', inviteeUri)
    .maybeSingle();

  if (!meeting || meeting.status === 'cancelled') {
    return { handled: true, reason: 'meeting_not_found' };
  }

  await supabase
    .from('meetings')
    .update({ status: 'cancelled' })
    .eq('id', meeting.id);

  return { handled: true, meetingId: meeting.id, cancelled: true };
}

/**
 * @param {object} body - parsed JSON webhook body
 * @param {{ platformUserId?: string }} [options]
 */
async function handleCalendlyWebhook(body, options = {}) {
  const eventType = body?.event ? String(body.event) : null;
  if (!eventType) {
    return { handled: false, reason: 'missing_event_type' };
  }

  switch (eventType) {
    case 'invitee.created':
      return handleInviteeCreated(body, options);
    case 'invitee.canceled':
      return handleInviteeCanceled(body);
    default:
      logger.info('[CalendlyWebhook] Ignoring unsupported event', { eventType });
      return { handled: true, ignored: true, eventType };
  }
}

module.exports = {
  verifyCalendlyWebhookSignature,
  handleCalendlyWebhook,
};
