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

async function threadHasUserReplyAfterLead(params) {
  const messages = await fetchThreadMessages(params.accessToken, params.threadId);
  return threadHasUserReplyAfterLeadFromMessages(
    messages,
    params.leadEmail,
    params.userEmail,
    params.outboundGmailMessageId,
  );
}

async function getLatestLeadReplyInThread(params) {
  const messages = await fetchThreadMessages(params.accessToken, params.threadId);
  return findLatestLeadReplyFromMessages(
    messages,
    params.leadEmail,
    params.userEmail,
    params.outboundGmailMessageId,
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
};
