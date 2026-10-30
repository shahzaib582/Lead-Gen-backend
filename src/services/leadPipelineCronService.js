const logger = require('../utils/logger');
const { ENTITY_CONFIG } = require('./leadPipeline/clientCategories');
const { runLeadPipeline } = require('./leadPipelineService');

const DEFAULT_PER_PAGE = 5;
const MAX_PER_PAGE = 10;
const CATEGORY_GAP_MS = 1500;

function listPipelineTargets() {
  const raw = String(process.env.LEAD_PIPELINE_TARGETS || '').trim();
  if (raw) {
    return raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const [entity, category] = item.split(':').map((part) => part.trim());
        return { entity, category };
      })
      .filter((item) => item.entity && item.category);
  }

  const targets = [];
  for (const [entity, cfg] of Object.entries(ENTITY_CONFIG)) {
    for (const category of Object.keys(cfg.categories || {})) {
      targets.push({ entity, category });
    }
  }
  return targets;
}

function resolvePerPage() {
  const n = Number(process.env.LEAD_PIPELINE_PER_PAGE);
  if (!Number.isInteger(n) || n < 1) return DEFAULT_PER_PAGE;
  return Math.min(n, MAX_PER_PAGE);
}

function resolvePage() {
  const n = Number(process.env.LEAD_PIPELINE_PAGE);
  if (Number.isInteger(n) && n >= 1) return n;
  const slot = Math.floor(Date.now() / (6 * 60 * 60 * 1000));
  return (slot % 10) + 1;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runScheduledLeadPipeline() {
  if (!process.env.APOLLO_API_KEY || !String(process.env.APOLLO_API_KEY).trim()) {
    logger.warn('[LeadPipelineCron] skipped: APOLLO_API_KEY is not configured');
    return { skipped: true, reason: 'APOLLO_NOT_CONFIGURED' };
  }

  const targets = listPipelineTargets();
  const perPage = resolvePerPage();
  const page = resolvePage();
  const results = [];

  logger.info('[LeadPipelineCron] starting', { targets: targets.length, perPage, page });

  for (let i = 0; i < targets.length; i += 1) {
    const { entity, category } = targets[i];
    try {
      const data = await runLeadPipeline('cron', {
        entity,
        category,
        per_page: perPage,
        page,
      });
      results.push({
        entity,
        category,
        found: data.found,
        saved: data.saved,
        inserted: data.inserted,
        updated: data.updated,
      });
    } catch (err) {
      logger.error('[LeadPipelineCron] category failed', {
        entity,
        category,
        error: err.message,
        code: err.code,
      });
      results.push({ entity, category, error: err.message });
    }

    if (i < targets.length - 1) await sleep(CATEGORY_GAP_MS);
  }

  const saved = results.reduce((sum, row) => sum + (Number(row.saved) || 0), 0);
  logger.info('[LeadPipelineCron] finished', { saved, failed: results.filter((r) => r.error).length });
  return { skipped: false, page, perPage, saved, results };
}

module.exports = {
  listPipelineTargets,
  resolvePerPage,
  resolvePage,
  runScheduledLeadPipeline,
};
