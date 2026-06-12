const { google } = require('googleapis');
const logger = require('../utils/logger');
const {
  getHeaderFromGmailMessage,
  normalizeMessageId,
  isInboundFromLead,
  threadHasUserReplyAfterLeadFromMessages,
  findLatestLeadReplyFromMessages,
} = require('../utils/gmailThread');

function createGmailClient(accessToken) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.gmail({ version: 'v1', auth });
}

/**
 * @returns {Promise<{ rfcMessageId: string|null, subject: string|null }>}
 */
async function fetchGmailMessageMetadata(accessToken, gmailMessageId) {
  if (!gmailMessageId) return { rfcMessageId: null, subject: null };

  const gmail = createGmailClient(accessToken);
  const { data } = await gmail.users.messages.get({
    userId: 'me',
    id: gmailMessageId,
    format: 'metadata',
    metadataHeaders: ['Message-ID', 'Subject'],
  });

  const rfcRaw = getHeaderFromGmailMessage(data, 'Message-ID');
  const subject = getHeaderFromGmailMessage(data, 'Subject');

  return {
    rfcMessageId: rfcRaw ? normalizeMessageId(rfcRaw) : null,
    subject: subject || null,
  };
}

/**
 * Scan a Gmail thread for an inbound message from the lead (not the sender).
 */
async function threadHasLeadReply({
  accessToken,
  threadId,
  leadEmail,
  userEmail,
  outboundGmailMessageId,
}) {
  if (!threadId || !leadEmail) return false;

  const gmail = createGmailClient(accessToken);
  const { data: thread } = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'metadata',
    metadataHeaders: ['From'],
  });

  for (const msg of thread.messages || []) {
    const from = getHeaderFromGmailMessage(msg, 'From');
    if (isInboundFromLead(from, leadEmail, userEmail, outboundGmailMessageId, msg.id)) {
      return true;
    }
  }

  return false;
}

/**
 * Best-effort; logs and returns nulls on failure (e.g. missing gmail.readonly on old tokens).
 */
async function safeFetchGmailMessageMetadata(accessToken, gmailMessageId) {
  try {
    return await fetchGmailMessageMetadata(accessToken, gmailMessageId);
  } catch (err) {
    logger.warn('[GmailThread] Failed to fetch message metadata', {
      gmailMessageId,
      error: err.message,
      code: err.code,
    });
    return { rfcMessageId: null, subject: null };
  }
}

async function safeThreadHasLeadReply(params) {
  try {
    return await threadHasLeadReply(params);
  } catch (err) {
    logger.warn('[GmailThread] Failed to scan thread for reply', {
      threadId: params.threadId,
      error: err.message,
      code: err.code,
    });
    return false;
  }
}

async function fetchThreadMessages(accessToken, threadId) {
  const gmail = createGmailClient(accessToken);
  const { data: thread } = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'metadata',
    metadataHeaders: ['From', 'Message-ID'],
  });
  return thread.messages || [];
}

/**
 * Fetch thread messages with their plain-text bodies for AI context.
 * Returns an array of { from, date, body } objects ordered oldest-first.
 * @param {string} accessToken
 * @param {string} threadId
 * @returns {Promise<Array<{ from: string, date: string, body: string }>>}
 */
async function fetchThreadBodies(accessToken, threadId) {
  const gmail = createGmailClient(accessToken);
  const { data: thread } = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'full',
  });

  const messages = thread.messages || [];

  function extractPlainText(payload) {
    if (!payload) return '';
    // Direct text/plain part
    if (payload.mimeType === 'text/plain' && payload.body?.data) {
      return Buffer.from(payload.body.data, 'base64').toString('utf-8');
    }
    // Walk parts recursively
    for (const part of payload.parts || []) {
      const text = extractPlainText(part);
      if (text) return text;
    }
    return '';
  }

  return messages.map((msg) => {
    const headers = msg.payload?.headers || [];
    const from = headers.find((h) => h.name?.toLowerCase() === 'from')?.value || '';
    const date = headers.find((h) => h.name?.toLowerCase() === 'date')?.value || '';
    const body = extractPlainText(msg.payload).trim();
    return { from, date, body };
  });
}

/**
 * Best-effort fetchThreadBodies — returns [] on failure.
 */
async function safeFetchThreadBodies(accessToken, threadId) {
  try {
    return await fetchThreadBodies(accessToken, threadId);
  } catch (err) {
    logger.warn('[GmailThread] Failed to fetch thread bodies', {
      threadId,
      error: err.message,
    });
    return [];
  }
}

async function threadHasUserReplyAfterLead(params) {
  const messages = await fetchThreadMessages(params.accessToken, params.threadId);
  return threadHasUserReplyAfterLeadFromMessages(
    messages,
    params.leadEmail,
    params.userEmail,
    params.outboundGmailMessageId
  );
}

async function getLatestLeadReplyInThread(params) {
  const messages = await fetchThreadMessages(params.accessToken, params.threadId);
  return findLatestLeadReplyFromMessages(
    messages,
    params.leadEmail,
    params.userEmail,
    params.outboundGmailMessageId
  );
}

async function safeThreadHasUserReplyAfterLead(params) {
  try {
    return await threadHasUserReplyAfterLead(params);
  } catch (err) {
    logger.warn('[GmailThread] Failed to check user reply after lead', {
      threadId: params.threadId,
      error: err.message,
    });
    return true;
  }
}

async function safeGetLatestLeadReplyInThread(params) {
  try {
    return await getLatestLeadReplyInThread(params);
  } catch (err) {
    logger.warn('[GmailThread] Failed to load latest lead reply headers', {
      threadId: params.threadId,
      error: err.message,
    });
    return null;
  }
}

module.exports = {
  fetchGmailMessageMetadata,
  threadHasLeadReply,
  safeFetchGmailMessageMetadata,
  safeThreadHasLeadReply,
  safeThreadHasUserReplyAfterLead,
  safeGetLatestLeadReplyInThread,
  fetchThreadBodies,
  safeFetchThreadBodies,
};
