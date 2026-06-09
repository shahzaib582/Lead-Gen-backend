const { google } = require('googleapis');
const { createOAuthClient } = require('../config/googleOAuth');
const {
  CALENDAR_SCOPE_WRITE,
  CALENDAR_SCOPE_READ,
  accountHasCalendarScope,
  accountCanWriteCalendar,
} = require('../utils/googleCalendarScopes');
const AppError = require('../utils/AppError');

/** Lazy require avoids circular dependency with googleAuthService. */
function googleAuthService() {
  return require('./googleAuthService');
}

async function getCalendarClientForUser(userId) {
  const account = await googleAuthService().findGoogleAccountByUserId(userId);
  if (!account) {
    throw new AppError('Google account not linked.', 400, 'GOOGLE_NOT_LINKED');
  }
  if (!accountCanWriteCalendar(account.scopes)) {
    throw new AppError(
      'Google Calendar not authorized. Reconnect Google (GET /api/auth/google) to grant calendar access.',
      403,
      'GOOGLE_CALENDAR_SCOPE_MISSING'
    );
  }

  const accessToken = await googleAuthService().getValidGoogleAccessToken(userId);
  const client = createOAuthClient();
  client.setCredentials({ access_token: accessToken });
  return google.calendar({ version: 'v3', auth: client });
}

/**
 * @param {object} opts
 * @param {string} opts.timeZone - IANA timezone for event (user profile or UTC)
 */
async function createCalendarEvent(userId, opts) {
  const calendar = await getCalendarClientForUser(userId);
  const {
    title,
    description,
    startAt,
    endAt,
    timeZone,
    attendeeEmail,
    addGoogleMeet = true,
  } = opts;

  const eventBody = {
    summary: title,
    description: description || undefined,
    start: {
      dateTime: new Date(startAt).toISOString(),
      timeZone: timeZone || 'UTC',
    },
    end: {
      dateTime: new Date(endAt).toISOString(),
      timeZone: timeZone || 'UTC',
    },
  };

  if (attendeeEmail) {
    eventBody.attendees = [{ email: attendeeEmail }];
  }

  if (addGoogleMeet) {
    eventBody.conferenceData = {
      createRequest: {
        requestId: `leadgen-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    };
  }

  const { data } = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: eventBody,
    conferenceDataVersion: addGoogleMeet ? 1 : 0,
    sendUpdates: attendeeEmail ? 'all' : 'none',
  });

  const meetLink =
    data.hangoutLink ||
    data.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri ||
    null;

  return {
    googleEventId: data.id,
    googleCalendarId: 'primary',
    meetLink,
  };
}

async function updateCalendarEvent(userId, googleEventId, opts) {
  const calendar = await getCalendarClientForUser(userId);
  const { title, description, startAt, endAt, timeZone, attendeeEmail } = opts;

  const patch = {};
  if (title != null) patch.summary = title;
  if (description != null) patch.description = description;
  if (startAt != null) {
    patch.start = {
      dateTime: new Date(startAt).toISOString(),
      timeZone: timeZone || 'UTC',
    };
  }
  if (endAt != null) {
    patch.end = {
      dateTime: new Date(endAt).toISOString(),
      timeZone: timeZone || 'UTC',
    };
  }
  if (attendeeEmail != null) {
    patch.attendees = attendeeEmail ? [{ email: attendeeEmail }] : [];
  }

  const { data } = await calendar.events.patch({
    calendarId: 'primary',
    eventId: googleEventId,
    requestBody: patch,
    sendUpdates: attendeeEmail ? 'all' : 'none',
  });

  const meetLink =
    data.hangoutLink ||
    data.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri ||
    null;

  return { meetLink };
}

async function deleteCalendarEvent(userId, googleEventId) {
  const calendar = await getCalendarClientForUser(userId);
  await calendar.events.delete({
    calendarId: 'primary',
    eventId: googleEventId,
    sendUpdates: 'all',
  });
}

module.exports = {
  CALENDAR_SCOPE_WRITE,
  CALENDAR_SCOPE_READ,
  accountHasCalendarScope,
  accountCanWriteCalendar,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
};
