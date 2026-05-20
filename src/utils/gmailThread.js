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
function isInboundFromLead(fromHeader, leadEmail, userEmail, outboundGmailMessageId, messageGmailId) {
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
};
