function missingKeys(keys) {
  return keys.filter((k) => !process.env[k] || String(process.env[k]).trim() === '');
}

function assertKeys(keys, label) {
  const missing = missingKeys(keys);
  if (missing.length) {
    throw new Error(`Missing required environment variables (${label}): ${missing.join(', ')}`);
  }
}

function assertJwtSecret() {
  if (!process.env.JWT_SECRET && !process.env.JWT_ACCESS_SECRET) {
    throw new Error(
      'Missing required environment variables: JWT_SECRET or JWT_ACCESS_SECRET'
    );
  }
}

function assertRedis() {
  if (!process.env.REDIS_URL && !process.env.REDIS_HOST) {
    throw new Error('Missing required environment variables: REDIS_URL or REDIS_HOST');
  }
}

const WEB_KEYS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SMTP_HOST',
  'SMTP_USER',
  'SMTP_PASS',
  'EMAIL_FROM',
];

const WORKER_MAIL_TEMPLATE_KEYS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'OPENAI_API_KEY',
];

const WORKER_CAMPAIGN_MAIL_KEYS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];

const WORKER_FOLLOW_UP_SCHEDULER_KEYS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];

function assertWebEnv() {
  assertKeys(WEB_KEYS, 'web');
  assertJwtSecret();
  assertRedis();
}

function assertWorkerMailTemplateEnv() {
  assertKeys(WORKER_MAIL_TEMPLATE_KEYS, 'mail-template-worker');
  assertRedis();
}

function assertWorkerCampaignMailEnv() {
  assertKeys(WORKER_CAMPAIGN_MAIL_KEYS, 'campaign-mail-worker');
  assertRedis();
}

function assertWorkerFollowUpSchedulerEnv() {
  assertKeys(WORKER_FOLLOW_UP_SCHEDULER_KEYS, 'follow-up-scheduler-worker');
  assertRedis();
}

function shouldRunWorkersInWeb() {
  const flag = process.env.RUN_WORKERS_IN_WEB;
  if (flag === '1' || flag === 'true') return true;
  if (flag === '0' || flag === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}

module.exports = {
  assertWebEnv,
  assertWorkerMailTemplateEnv,
  assertWorkerCampaignMailEnv,
  assertWorkerFollowUpSchedulerEnv,
  shouldRunWorkersInWeb,
};
