/**
 * Follow-up due dates are measured from the initial campaign email sent_at (calendar days, UTC).
 * @param {string|Date} initialSentAt
 * @param {number} waitingDays
 * @returns {Date}
 */
function computeFollowUpDueAt(initialSentAt, waitingDays) {
  const base = initialSentAt instanceof Date ? new Date(initialSentAt.getTime()) : new Date(initialSentAt);
  const days = Number(waitingDays);
  if (Number.isNaN(base.getTime())) {
    throw new Error('Invalid initialSentAt for follow-up due date.');
  }
  if (!Number.isInteger(days) || days < 0) {
    throw new Error('waiting_days must be a non-negative integer.');
  }
  base.setUTCDate(base.getUTCDate() + days);
  return base;
}

/**
 * @param {string|Date} initialSentAt
 * @param {number} waitingDays
 * @param {Date} [now]
 * @returns {boolean}
 */
function isFollowUpDue(initialSentAt, waitingDays, now = new Date()) {
  const dueAt = computeFollowUpDueAt(initialSentAt, waitingDays);
  return now.getTime() >= dueAt.getTime();
}

module.exports = { computeFollowUpDueAt, isFollowUpDue };
