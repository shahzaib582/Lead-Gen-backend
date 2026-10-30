const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { searchApollo, ApolloError } = require('./leadPipeline/apollo');
const { findHunterEmail, verifyHunterEmail } = require('./leadPipeline/hunter');
const { ENTITY_CONFIG } = require('./leadPipeline/clientCategories');
const { LEAD_CLASSES } = require('./leadPipeline/leadClasses');
const { validateCategoryRequest } = require('./leadPipeline/validation');
const { runPipeline } = require('./leadPipeline/pipeline');
const { createLeadsDataRepo } = require('./leadPipeline/leadsDataRepo');

const MAX_PER_PAGE = 25;
const DEFAULT_PER_PAGE = 10;

function mapApolloError(err) {
  if (err.kind === 'authentication') {
    return new AppError('Apollo authentication failed.', 502, 'APOLLO_AUTH');
  }
  if (err.kind === 'rate_limit') {
    const mapped = new AppError('Apollo rate limit exceeded.', 429, 'APOLLO_RATE_LIMIT');
    if (err.retryAfter) mapped.retryAfter = err.retryAfter;
    return mapped;
  }
  return new AppError('Apollo lead search failed.', 502, 'APOLLO_UPSTREAM');
}

async function runLeadPipeline(userId, body) {
  const apolloKey = process.env.APOLLO_API_KEY;
  if (!apolloKey || !String(apolloKey).trim()) {
    throw new AppError('Apollo integration is not configured.', 500, 'APOLLO_NOT_CONFIGURED');
  }

  const withDefaults =
    body && typeof body === 'object' && body.per_page === undefined
      ? { ...body, per_page: DEFAULT_PER_PAGE }
      : body;

  let validated;
  try {
    validated = validateCategoryRequest(withDefaults);
  } catch (err) {
    throw new AppError(err.message || 'Invalid request.', 400);
  }

  const warnings = [];
  const perPage = Math.min(validated.request.per_page, MAX_PER_PAGE);
  if (validated.request.per_page > MAX_PER_PAGE) {
    warnings.push(`per_page capped at ${MAX_PER_PAGE}.`);
  }

  const hunterKey = process.env.HUNTER_API_KEY ? String(process.env.HUNTER_API_KEY).trim() : '';
  const hunter = hunterKey
    ? {
        verify: (email) => verifyHunterEmail(email, hunterKey),
        find: (params) => findHunterEmail(params, hunterKey),
      }
    : null;

  const entityCfg = ENTITY_CONFIG[validated.request.entity];
  const categoryCfg = entityCfg.categories[validated.request.category] ?? null;

  let apollo;
  try {
    apollo = await searchApollo(
      { page: validated.request.page, per_page: perPage, search: validated.search },
      apolloKey
    );
  } catch (err) {
    if (err instanceof ApolloError) throw mapApolloError(err);
    throw err;
  }

  const startedAt = Date.now();
  const result = await runPipeline({
    people: apollo.people,
    campaignId: null,
    leadType: validated.lead_type,
    leadClass: validated.lead_class,
    targetSegment: validated.target_segment,
    categoryConfig: categoryCfg,
    targetLocations: validated.request.locations ?? entityCfg.default_locations,
    repo: createLeadsDataRepo(),
    hunter,
  });

  logger.info('[LeadPipeline] completed', {
    userId,
    entity: validated.request.entity,
    category: validated.request.category,
    ...result.stats,
    durationMs: Date.now() - startedAt,
  });

  return {
    success: true,
    entity: validated.request.entity,
    category: validated.request.category,
    target_segment: validated.target_segment,
    lead_type: validated.lead_type,
    lead_class: validated.lead_class,
    lead_class_label: LEAD_CLASSES[validated.lead_class].label,
    requested: perPage,
    found: result.stats.found,
    saved: result.stats.inserted + result.stats.updated,
    inserted: result.stats.inserted,
    updated: result.stats.updated,
    already_verified: result.stats.already_verified,
    stats: result.stats,
    leads: result.leads,
    warnings: [...warnings, ...result.warnings],
  };
}

module.exports = {
  runLeadPipeline,
};
