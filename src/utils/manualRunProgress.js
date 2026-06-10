const { getMailDelayBoundsMs, randomDelayMs } = require('../config/mailDelay');

function getManualRunInstantMaxLeads() {
  const n = Number(process.env.MANUAL_RUN_INSTANT_MAX_LEADS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 15;
}

function getManualRunBannerMinLeads() {
  const n = Number(process.env.MANUAL_RUN_BANNER_MIN_LEADS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 6;
}

function getManualRunSmallBatchGapMs() {
  const n = Number(process.env.MANUAL_RUN_SMALL_BATCH_GAP_MS);
  return Number.isFinite(n) && n >= 0 ? n : 2000;
}

/** Delay before the next lead in a manual run (index is 0-based). */
function manualRunInterLeadDelayMs(leadCount, index) {
  if (index >= leadCount - 1) return 0;
  if (leadCount <= getManualRunInstantMaxLeads()) {
    return getManualRunSmallBatchGapMs();
  }
  return randomDelayMs();
}

function buildManualRunProgressMeta(leadCount) {
  const instantMax = getManualRunInstantMaxLeads();
  const bannerMin = getManualRunBannerMinLeads();
  const isFastBatch = leadCount <= instantMax;
  const showProgressBanner = leadCount >= bannerMin;
  const { minMs, maxMs } = getMailDelayBoundsMs();
  const gapMs = isFastBatch ? getManualRunSmallBatchGapMs() : (minMs + maxMs) / 2;
  const estimatedDurationMinutes = Math.max(
    1,
    Math.ceil(((leadCount - 1) * gapMs) / 60000 + leadCount * 0.5)
  );

  let userMessage = null;
  if (showProgressBanner && !isFastBatch) {
    userMessage =
      'Sending emails in batches. This process may take a few minutes. Please check back shortly.';
  } else if (showProgressBanner && isFastBatch) {
    userMessage = 'Sending emails now. Refresh the lead list or watch progress for live updates.';
  }

  return {
    leadsQueued: leadCount,
    processingMode: 'background',
    batchMode: isFastBatch ? 'fast' : 'throttled',
    showProgressBanner,
    estimatedDurationMinutes,
    delayBetweenEmailsSecondsMin: isFastBatch
      ? getManualRunSmallBatchGapMs() / 1000
      : minMs / 1000,
    delayBetweenEmailsSecondsMax: isFastBatch
      ? getManualRunSmallBatchGapMs() / 1000
      : maxMs / 1000,
    userMessage,
    pollHint: 'Use campaign SSE events or refresh leads for live status.',
  };
}

module.exports = {
  getManualRunInstantMaxLeads,
  getManualRunBannerMinLeads,
  getManualRunSmallBatchGapMs,
  manualRunInterLeadDelayMs,
  buildManualRunProgressMeta,
};
