import { isLeadClass, type LeadClass } from './lead-classes.ts';
import { LEAD_TYPES, type LeadSearchRequest } from './lead.ts';
import type { ApolloSearchCriteria } from './apollo.ts';
import {
  requireCategoryConfig,
  formatTargetSegment,
  buildApolloParamsForCategory,
  GLOBAL_EXCLUDED_DOMAINS,
  LEAD_CLASS_DEFAULTS,
  type Entity,
} from './client-categories.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SEARCH_FIELDS = [
  'industries',
  'job_titles',
  'seniorities',
  'departments',
  'locations',
  'employee_ranges',
  'revenue_ranges',
  'keywords',
  'keyword_tags',
  'company_domains',
  'technologies',
  'exclude_domains',
] as const;

// ---------------------------------------------------------------------------
// Raw Apollo search request (no entity/category)
// ---------------------------------------------------------------------------

export const validateRequest = (
  body: unknown
): { request: LeadSearchRequest; search: ApolloSearchCriteria } => {
  if (!body || typeof body !== 'object') throw new Error('Request body must be a JSON object');
  const value = body as Record<string, unknown>;

  if (typeof value.campaign_id !== 'string' || !UUID.test(value.campaign_id))
    throw new Error('campaign_id must be a valid UUID');
  if (value.page !== undefined && (!Number.isInteger(value.page) || (value.page as number) < 1))
    throw new Error('page must be a positive integer');
  if (
    value.per_page !== undefined &&
    (!Number.isInteger(value.per_page) ||
      (value.per_page as number) < 1 ||
      (value.per_page as number) > 100)
  )
    throw new Error('per_page must be between 1 and 100');
  if (
    value.search !== undefined &&
    (!value.search || typeof value.search !== 'object' || Array.isArray(value.search))
  )
    throw new Error('search must be an object');

  const rawSearch = (value.search ?? {}) as Record<string, unknown>;
  const search: Record<string, string[]> = {};
  for (const field of SEARCH_FIELDS) {
    if (rawSearch[field] !== undefined) {
      if (
        !Array.isArray(rawSearch[field]) ||
        (rawSearch[field] as unknown[]).some((item) => typeof item !== 'string' || !item.trim())
      )
        throw new Error(`search.${field} must be an array of non-empty strings`);
      search[field] = (rawSearch[field] as string[]).map((item) => item.trim()).slice(0, 100);
    }
  }

  // Always inject global excluded domains into every search
  const existingExcludes: string[] = Array.isArray(search.exclude_domains)
    ? search.exclude_domains
    : [];
  search.exclude_domains = [...new Set([...GLOBAL_EXCLUDED_DOMAINS, ...existingExcludes])];

  if (
    value.lead_type !== undefined &&
    value.lead_type !== null &&
    (typeof value.lead_type !== 'string' || !LEAD_TYPES.includes(value.lead_type as never))
  )
    throw new Error('lead_type is invalid');
  if (
    value.target_segment !== undefined &&
    value.target_segment !== null &&
    (typeof value.target_segment !== 'string' || value.target_segment.trim().length > 200)
  )
    throw new Error('target_segment is invalid');

  return {
    request: {
      campaign_id: value.campaign_id,
      page: (value.page as number | undefined) ?? 1,
      per_page: (value.per_page as number | undefined) ?? 25,
      search,
      lead_type: (value.lead_type as LeadSearchRequest['lead_type']) ?? null,
      target_segment: typeof value.target_segment === 'string' ? value.target_segment.trim() : null,
    },
    search,
  };
};

// ---------------------------------------------------------------------------
// Category-aware request (entity + category drives all Apollo params)
// ---------------------------------------------------------------------------

export interface CategoryRequest {
  campaign_id: string;
  entity: Entity;
  category: string;
  lead_class?: LeadClass;
  /** Override geography; defaults to entity's default_locations */
  locations?: string[];
  /** Extra domains to exclude on top of GLOBAL_EXCLUDED_DOMAINS */
  exclude_domains?: string[];
  page: number;
  per_page: number;
}

export interface ValidatedCategoryRequest {
  request: CategoryRequest;
  search: ApolloSearchCriteria;
  lead_type: string;
  lead_class: LeadClass;
  target_segment: string;
}

export const validateCategoryRequest = (body: unknown): ValidatedCategoryRequest => {
  if (!body || typeof body !== 'object') throw new Error('Request body must be a JSON object');
  const value = body as Record<string, unknown>;

  if (typeof value.campaign_id !== 'string' || !UUID.test(value.campaign_id))
    throw new Error('campaign_id must be a valid UUID');

  let reqLeadClass: LeadClass | null = null;
  if (value.lead_class !== undefined && value.lead_class !== null) {
    if (!isLeadClass(value.lead_class)) {
      throw new Error(
        `lead_class "${value.lead_class}" is invalid. Valid codes: LEAD-01, LEAD-02, LEAD-03, LEAD-04, LEAD-05, LEAD-06`
      );
    }
    reqLeadClass = value.lead_class;
  }

  // If entity/category are not provided but lead_class is, default them from LEAD_CLASS_DEFAULTS
  if ((!value.entity || typeof value.entity !== 'string' || !value.entity.trim()) && reqLeadClass) {
    const defaults = LEAD_CLASS_DEFAULTS[reqLeadClass];
    value.entity = defaults.entity;
    value.category = defaults.category;
  }

  if (typeof value.entity !== 'string' || !value.entity.trim())
    throw new Error('entity is required');
  if (typeof value.category !== 'string' || !value.category.trim())
    throw new Error('category is required');

  // Throws descriptive error if entity/category combo is invalid
  const categoryCfg = requireCategoryConfig(value.entity, value.category);

  if (value.page !== undefined && (!Number.isInteger(value.page) || (value.page as number) < 1))
    throw new Error('page must be a positive integer');
  if (
    value.per_page !== undefined &&
    (!Number.isInteger(value.per_page) ||
      (value.per_page as number) < 1 ||
      (value.per_page as number) > 100)
  )
    throw new Error('per_page must be between 1 and 100');

  // Validate optional location override
  let overrideLocations: string[] | undefined;
  if (value.locations !== undefined) {
    if (
      !Array.isArray(value.locations) ||
      (value.locations as unknown[]).some((l) => typeof l !== 'string' || !l.trim())
    )
      throw new Error('locations must be an array of non-empty strings');
    overrideLocations = (value.locations as string[]).map((l) => l.trim());
  }

  // Validate optional extra exclude_domains
  let extraExcludes: string[] = [];
  if (value.exclude_domains !== undefined) {
    if (
      !Array.isArray(value.exclude_domains) ||
      (value.exclude_domains as unknown[]).some((d) => typeof d !== 'string' || !d.trim())
    )
      throw new Error('exclude_domains must be an array of non-empty strings');
    extraExcludes = (value.exclude_domains as string[]).map((d) => d.trim().toLowerCase());
  }

  // Build Apollo search params from category config
  const apolloParams = buildApolloParamsForCategory(
    value.entity as Entity,
    value.category,
    overrideLocations
  );

  const search: ApolloSearchCriteria = {
    industries: apolloParams.industries,
    job_titles: apolloParams.titles,
    keywords: apolloParams.keywords,
    keyword_tags: apolloParams.keywords, // also send as keyword_tags for higher-plan support
    employee_ranges: apolloParams.employee_ranges,
    locations: apolloParams.locations,
    exclude_domains: [...new Set([...GLOBAL_EXCLUDED_DOMAINS, ...extraExcludes])],
  };

  const target_segment = formatTargetSegment(value.entity, value.category);
  const page = (value.page as number | undefined) ?? 1;
  const per_page = (value.per_page as number | undefined) ?? 5;

  return {
    request: {
      campaign_id: value.campaign_id,
      entity: value.entity as Entity,
      category: value.category,
      lead_class: reqLeadClass ?? categoryCfg.lead_class,
      locations: overrideLocations,
      exclude_domains: extraExcludes,
      page,
      per_page,
    },
    search,
    lead_type: categoryCfg.lead_type,
    lead_class: reqLeadClass ?? categoryCfg.lead_class,
    target_segment,
  };
};
