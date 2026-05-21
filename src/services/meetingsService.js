const supabase = require('../config/supabase');
const AppError = require('../utils/AppError');
const { resolveUserTimezone } = require('../utils/timezone');
const googleAuthService = require('./googleAuthService');
const {
  accountCanWriteCalendar,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} = require('./googleCalendarService');

async function resolveCampaignLeadContext(userId, campaignLeadId) {
  if (!campaignLeadId) return { campaignId: null, attendeeEmail: null };

  const { data: lead, error } = await supabase
    .from('campaign_leads')
    .select('id, user_id, campaign_id, lead_data_id')
    .eq('id', campaignLeadId)
    .maybeSingle();

  if (error) throw new AppError('Failed to load campaign lead.', 500);
  if (!lead || lead.user_id !== userId) {
    throw new AppError('Campaign lead not found.', 404);
  }

  let attendeeEmail = null;
  const { data: leadData } = await supabase
    .from('leads_data')
    .select('email')
    .eq('id', lead.lead_data_id)
    .maybeSingle();
  if (leadData?.email) attendeeEmail = leadData.email;

  return { campaignId: lead.campaign_id, attendeeEmail };
}

async function getMeetingForUser(userId, meetingId) {
  const { data, error } = await supabase
    .from('meetings')
    .select('*')
    .eq('id', meetingId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw new AppError('Failed to load meeting.', 500);
  if (!data) throw new AppError('Meeting not found.', 404);
  return data;
}

async function listMeetings(userId, { status, campaignId, from, to, page = 1, limit = 20 } = {}) {
  const safeLimit = Math.min(Math.max(limit, 1), 50);
  const safePage = Math.max(page, 1);
  const fromIdx = (safePage - 1) * safeLimit;
  const toIdx = fromIdx + safeLimit - 1;

  let query = supabase
    .from('meetings')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .order('start_at', { ascending: false });

  if (status) query = query.eq('status', status);
  if (campaignId) query = query.eq('campaign_id', campaignId);
  if (from) query = query.gte('start_at', new Date(from).toISOString());
  if (to) query = query.lte('start_at', new Date(to).toISOString());

  const { data, error, count } = await query.range(fromIdx, toIdx);

  if (error) {
    if (/meetings|relation|does not exist/i.test(error.message)) {
      return { meetings: [], total: 0, page: safePage, limit: safeLimit };
    }
    throw new AppError('Failed to list meetings.', 500);
  }

  return {
    meetings: data || [],
    total: count ?? 0,
    page: safePage,
    limit: safeLimit,
  };
}

async function createMeeting(userId, userRow, body) {
  const {
    title,
    description,
    start_at: startAt,
    end_at: endAt,
    attendee_email: attendeeEmailInput,
    campaign_id: campaignIdInput,
    campaign_lead_id: campaignLeadId,
    sync_google: syncGoogle = true,
    add_google_meet: addGoogleMeet = true,
  } = body;

  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new AppError('Invalid start_at or end_at.', 422);
  }
  if (end <= start) {
    throw new AppError('end_at must be after start_at.', 422);
  }

  let campaignId = campaignIdInput || null;
  let attendeeEmail = attendeeEmailInput || null;

  if (campaignLeadId) {
    const ctx = await resolveCampaignLeadContext(userId, campaignLeadId);
    campaignId = ctx.campaignId;
    if (!attendeeEmail && ctx.attendeeEmail) attendeeEmail = ctx.attendeeEmail;
  }

  if (campaignId) {
    const { data: camp, error: campErr } = await supabase
      .from('campaigns')
      .select('id')
      .eq('id', campaignId)
      .eq('user_id', userId)
      .maybeSingle();
    if (campErr) throw new AppError('Failed to verify campaign.', 500);
    if (!camp) throw new AppError('Campaign not found.', 404);
  }

  const timeZone = resolveUserTimezone(userRow);

  const { data: row, error: insertErr } = await supabase
    .from('meetings')
    .insert({
      user_id: userId,
      campaign_id: campaignId,
      campaign_lead_id: campaignLeadId || null,
      title: String(title).trim(),
      description: description ? String(description).trim() : null,
      attendee_email: attendeeEmail ? String(attendeeEmail).trim().toLowerCase() : null,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      status: 'scheduled',
    })
    .select()
    .single();

  if (insertErr) {
    throw new AppError(insertErr.message || 'Failed to create meeting.', 500);
  }

  const { notifyMeetingBooked } = require('./notificationService');
  void notifyMeetingBooked(userId, row);

  if (!syncGoogle) return row;

  const account = await googleAuthService.findGoogleAccountByUserId(userId);
  if (!account || !accountCanWriteCalendar(account.scopes)) {
    return row;
  }

  try {
    const google = await createCalendarEvent(userId, {
      title: row.title,
      description: row.description,
      startAt: row.start_at,
      endAt: row.end_at,
      timeZone,
      attendeeEmail: row.attendee_email,
      addGoogleMeet,
    });

    const { data: updated, error: updErr } = await supabase
      .from('meetings')
      .update({
        google_event_id: google.googleEventId,
        google_calendar_id: google.googleCalendarId,
        meet_link: google.meetLink,
      })
      .eq('id', row.id)
      .select()
      .single();

    if (updErr) throw new AppError('Meeting saved but failed to store Google event id.', 500);
    return updated;
  } catch (err) {
    await supabase.from('meetings').delete().eq('id', row.id);
    throw err;
  }
}

async function updateMeeting(userId, userRow, meetingId, body) {
  const existing = await getMeetingForUser(userId, meetingId);
  if (existing.status === 'cancelled') {
    throw new AppError('Cannot update a cancelled meeting.', 409);
  }

  const patch = {};
  if (body.title != null) patch.title = String(body.title).trim();
  if (body.description != null) {
    patch.description = body.description ? String(body.description).trim() : null;
  }
  if (body.attendee_email != null) {
    patch.attendee_email = body.attendee_email
      ? String(body.attendee_email).trim().toLowerCase()
      : null;
  }
  if (body.start_at != null) patch.start_at = new Date(body.start_at).toISOString();
  if (body.end_at != null) patch.end_at = new Date(body.end_at).toISOString();
  if (body.status != null) patch.status = body.status;

  if (patch.start_at && patch.end_at && new Date(patch.end_at) <= new Date(patch.start_at)) {
    throw new AppError('end_at must be after start_at.', 422);
  }

  const { data, error } = await supabase
    .from('meetings')
    .update(patch)
    .eq('id', meetingId)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) throw new AppError('Failed to update meeting.', 500);

  if (existing.google_event_id && Object.keys(patch).length > 0) {
    const account = await googleAuthService.findGoogleAccountByUserId(userId);
    if (account && accountCanWriteCalendar(account.scopes)) {
      const timeZone = resolveUserTimezone(userRow);
      const google = await updateCalendarEvent(userId, existing.google_event_id, {
        title: data.title,
        description: data.description,
        startAt: data.start_at,
        endAt: data.end_at,
        timeZone,
        attendeeEmail: data.attendee_email,
      });
      if (google.meetLink && google.meetLink !== data.meet_link) {
        const { data: withLink } = await supabase
          .from('meetings')
          .update({ meet_link: google.meetLink })
          .eq('id', meetingId)
          .select()
          .single();
        return withLink || data;
      }
    }
  }

  return data;
}

async function cancelMeeting(userId, meetingId) {
  const existing = await getMeetingForUser(userId, meetingId);

  if (existing.google_event_id) {
    const account = await googleAuthService.findGoogleAccountByUserId(userId);
    if (account && accountCanWriteCalendar(account.scopes)) {
      try {
        await deleteCalendarEvent(userId, existing.google_event_id);
      } catch {
        // Still mark cancelled in DB if Google delete fails (event may already be gone)
      }
    }
  }

  const { data, error } = await supabase
    .from('meetings')
    .update({ status: 'cancelled' })
    .eq('id', meetingId)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) throw new AppError('Failed to cancel meeting.', 500);
  return data;
}

async function countScheduledMeetings(userId) {
  const { count, error } = await supabase
    .from('meetings')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'scheduled');

  if (error) {
    if (/meetings|relation|does not exist/i.test(error.message)) return 0;
    throw new AppError('Failed to count meetings.', 500);
  }
  return count ?? 0;
}

async function loadMeetingRowsInRange(userId, fromIso, toIso) {
  const { data, error } = await supabase
    .from('meetings')
    .select('start_at, status')
    .eq('user_id', userId)
    .eq('status', 'scheduled')
    .gte('start_at', fromIso)
    .lte('start_at', toIso);

  if (error) {
    if (/meetings|relation|does not exist/i.test(error.message)) return [];
    throw new AppError('Failed to load meeting metrics.', 500);
  }
  return data || [];
}

module.exports = {
  listMeetings,
  createMeeting,
  updateMeeting,
  cancelMeeting,
  getMeetingForUser,
  countScheduledMeetings,
  loadMeetingRowsInRange,
};
