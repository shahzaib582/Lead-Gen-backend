function toPublicMeeting(row) {
  if (!row) return null;
  return {
    id: row.id,
    campaignId: row.campaign_id ?? null,
    campaignLeadId: row.campaign_lead_id ?? null,
    title: row.title,
    description: row.description ?? null,
    attendeeEmail: row.attendee_email ?? null,
    startAt: row.start_at,
    endAt: row.end_at,
    meetLink: row.meet_link ?? null,
    googleEventId: row.google_event_id ?? null,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = { toPublicMeeting };
