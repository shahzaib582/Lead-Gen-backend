/**
 * Gmail threading helpers (RFC headers + reply subject).
 */

function parseEmailAddress(headerValue) {
  if (!headerValue) return '';
  const raw = String(headerValue).trim();
  const angle = raw.match(/<([^>]+)>/);
  return (angle ? angle[1] : raw).trim().toLowerCase();
}

function normalizeMessageId(messageId) {
  if (!messageId) return '';
  const trimmed = String(messageId).trim();
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) return trimmed;
  return `<${trimmed.replace(/^<|>$/g, '')}>`;
}

function getHeaderFromGmailMessage(message, name) {
  const headers = message?.payload?.headers || [];
  const found = headers.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return found?.value || '';
}

function buildReplySubject(originalSubject) {
  const subject = String(originalSubject || '').trim() || '(no subject)';
  if (/^re:\s/i.test(subject)) return subject;
  return `Re: ${subject}`;
}

/**
 * True when From is the lead and not the user's Gmail address (inbound reply).
 */
function sortGmailMessagesByDate(messages) {
  return [...(messages || [])].sort(
    (a, b) => Number(a.internalDate || 0) - Number(b.internalDate || 0)
  );
}

/**
 * True if the user sent any message in the thread after the lead's latest inbound reply.
 */
function threadHasUserReplyAfterLeadFromMessages(
  messages,
  leadEmail,
  userEmail,
  outboundGmailMessageId
) {
  const sorted = sortGmailMessagesByDate(messages);
  let lastLeadIdx = -1;

  for (let i = 0; i < sorted.length; i++) {
    const from = getHeaderFromGmailMessage(sorted[i], 'From');
    if (isInboundFromLead(from, leadEmail, userEmail, outboundGmailMessageId, sorted[i].id)) {
      lastLeadIdx = i;
    }
  }

  if (lastLeadIdx < 0) return false;

  const user = parseEmailAddress(userEmail);
  for (let i = lastLeadIdx + 1; i < sorted.length; i++) {
    const from = parseEmailAddress(getHeaderFromGmailMessage(sorted[i], 'From'));
    if (user && from === user) return true;
  }

  return false;
}

/**
 * Latest inbound lead message in thread (for In-Reply-To on thank-you draft).
 * @returns {{ gmailMessageId: string, rfcMessageId: string|null }|null}
 */
function findLatestLeadReplyFromMessages(messages, leadEmail, userEmail, outboundGmailMessageId) {
  const sorted = sortGmailMessagesByDate(messages);
  let latest = null;

  for (const msg of sorted) {
    const from = getHeaderFromGmailMessage(msg, 'From');
    if (!isInboundFromLead(from, leadEmail, userEmail, outboundGmailMessageId, msg.id)) {
      continue;
    }
    const rfcRaw = getHeaderFromGmailMessage(msg, 'Message-ID');
    latest = {
      gmailMessageId: msg.id,
      rfcMessageId: rfcRaw ? normalizeMessageId(rfcRaw) : null,
    };
  }

  return latest;
}

function isInboundFromLead(
  fromHeader,
  leadEmail,
  userEmail,
  outboundGmailMessageId,
  messageGmailId
) {
  if (outboundGmailMessageId && messageGmailId === outboundGmailMessageId) {
    return false;
  }
  const from = parseEmailAddress(fromHeader);
  const lead = parseEmailAddress(leadEmail);
  const user = parseEmailAddress(userEmail);
  if (!from || !lead) return false;
  if (user && from === user) return false;
  return from === lead;
}

module.exports = {
  parseEmailAddress,
  normalizeMessageId,
  getHeaderFromGmailMessage,
  buildReplySubject,
  isInboundFromLead,
  sortGmailMessagesByDate,
  threadHasUserReplyAfterLeadFromMessages,
  findLatestLeadReplyFromMessages,
};
