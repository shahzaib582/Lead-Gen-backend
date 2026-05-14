/**
 * Shared inter-send delay bounds for BullMQ mail worker and HTTP sendCampaignEmails.
 * Env: MAIL_DELAY_MIN_MS, MAIL_DELAY_MAX_MS (defaults 3–5 minutes).
 */

const DEFAULT_MIN_MS = 180000; // 3 minutes
const DEFAULT_MAX_MS = 300000; // 5 minutes

function getMailDelayBoundsMs() {
  const min = Number(process.env.MAIL_DELAY_MIN_MS);
  const max = Number(process.env.MAIL_DELAY_MAX_MS);
  const lo = Number.isFinite(min) && min >= 0 ? min : DEFAULT_MIN_MS;
  const hi = Number.isFinite(max) && max >= lo ? max : Math.max(lo, DEFAULT_MAX_MS);
  return { minMs: lo, maxMs: hi };
}

function randomDelayMs() {
  const { minMs, maxMs } = getMailDelayBoundsMs();
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

module.exports = {
  getMailDelayBoundsMs,
  randomDelayMs,
  DEFAULT_MIN_MS,
  DEFAULT_MAX_MS,
};
