/**
 * Apollo People Search v1 – verified parameter mapping:
 *
 *  organization_industries[]         → string-label industry filter (works on all plans)
 *  organization_industry_tag_ids[]   → numeric ID filter (higher-tier plans only; we do NOT use)
 *  person_titles[]                   → job title filter ✓
 *  person_seniorities[]              → seniority filter ✓
 *  person_departments[]              → department filter ✓
 *  person_locations[]                → person geography ✓
 *  organization_locations[]          → company geography ✓
 *  organization_num_employees_ranges[] → size buckets ✓
 *  q_keywords                        → general keyword string ✓ (all plans)
 *  q_organization_keyword_tags[]     → org-level keyword tags (higher-tier plans; we send
 *                                      it in addition to q_keywords; Apollo ignores if unsupported)
 *  not_organization_websites_list[]  → domain exclusion blacklist ✓
 *  q_organization_domains_list[]     → target specific domains ✓
 *  currently_using_any_of_technology_uids[] → technology filter ✓
 *
 * Industries NOT confirmed to resolve on basic plans:
 *   "Leisure and Fitness", "Facilities Services", "Professional Services",
 *   "Health, Wellness & Fitness", "Information Technology & Services" (use full label).
 * Fallback: rely on q_keywords + person_titles when industry yields zero results.
 */
export interface ApolloSearchCriteria {
  industries?: string[];
  job_titles?: string[];
  seniorities?: string[];
  departments?: string[];
  locations?: string[];
  employee_ranges?: string[];
  revenue_ranges?: string[];
  keywords?: string[];
  /** keyword tags sent as q_organization_keyword_tags[] (higher-tier plans) */
  keyword_tags?: string[];
  company_domains?: string[];
  technologies?: string[];
  /** Domains excluded via not_organization_websites_list[] */
  exclude_domains?: string[];
}

export interface ApolloSearchOptions {
  page: number;
  per_page: number;
  search: ApolloSearchCriteria;
}

export interface ApolloOrganization {
  id?: string | null;
  name?: string | null;
  primary_domain?: string | null;
  domain?: string | null;
  website_url?: string | null;
  linkedin_url?: string | null;
  industry?: string | null;
  industries?: string[] | null;
  secondary_industries?: string[] | null;
  estimated_num_employees?: number | null;
  annual_revenue_printed?: string | null;
  raw_address?: string | null;
  street_address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  short_description?: string | null;
  technologies?: string[] | null;
  organization_type?: string | null;
  organization_revenue_printed?: string | null;
  organization_revenue?: number | null;
  keywords?: string[] | null;
}

export interface ApolloPerson {
  id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  last_name_obfuscated?: string | null;
  name?: string | null;
  title?: string | null;
  seniority?: string | null;
  departments?: string[] | null;
  email?: string | null;
  phone_numbers?: Array<{ raw_number?: string | null; sanitized_number?: string | null }> | null;
  linkedin_url?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  timezone?: string | null;
  headline?: string | null;
  last_refreshed_at?: string | null;
  organization?: ApolloOrganization | null;
  time_zone?: string | null;
  functions?: string[] | null;
  subdepartments?: string[] | null;
  match_confidence?: string | null;
  email_status?: string | null;
  email_domain_catchall_verdict?: string | null;
  employment_history?: unknown[] | null;
}

export interface ApolloSearchResponse {
  people: ApolloPerson[];
  total_entries: number;
}

interface ApolloBulkMatchResponse {
  matches?: Array<ApolloPerson | null>;
}

export class ApolloError extends Error {
  constructor(
    public readonly kind: 'authentication' | 'rate_limit' | 'upstream' | 'malformed',
    public readonly status?: number,
    public readonly retryAfter?: string | null
  ) {
    super(`Apollo ${kind} error`);
  }
}

const appendArray = (params: URLSearchParams, key: string, values?: string[]) => {
  values?.forEach((value) => params.append(`${key}[]`, value));
};

export const buildApolloSearchUrl = (options: ApolloSearchOptions, endpoint: string) => {
  const params = new URLSearchParams({
    page: String(options.page),
    per_page: String(options.per_page),
  });
  const search = options.search;

  // Industry string-label filter (works on all Apollo plans)
  appendArray(params, 'organization_industries', search.industries);

  // People filters
  appendArray(params, 'person_titles', search.job_titles);
  appendArray(params, 'person_seniorities', search.seniorities);
  appendArray(params, 'person_departments', search.departments);

  // Geography – send to both person and org location fields
  appendArray(params, 'person_locations', search.locations);
  appendArray(params, 'organization_locations', search.locations);

  // Company size / revenue
  appendArray(params, 'organization_num_employees_ranges', search.employee_ranges);
  appendArray(params, 'organization_revenue_ranges', search.revenue_ranges);

  // Keywords: q_keywords (all plans) + q_organization_keyword_tags (higher-tier plans)
  if (search.keywords?.length) params.set('q_keywords', search.keywords.join(' '));
  if (search.keyword_tags?.length)
    appendArray(params, 'q_organization_keyword_tags', search.keyword_tags);

  // Domain filters
  appendArray(params, 'q_organization_domains_list', search.company_domains);

  // Domain exclusion blacklist
  appendArray(params, 'not_organization_websites_list', search.exclude_domains);

  // Technology filter
  appendArray(params, 'currently_using_any_of_technology_uids', search.technologies);

  return `${endpoint}?${params.toString()}`;
};

export const searchApollo = async (
  options: ApolloSearchOptions,
  apiKey: string
): Promise<ApolloSearchResponse> => {
  const endpoint =
    Deno.env.get('APOLLO_SEARCH_URL') ?? 'https://api.apollo.io/api/v1/mixed_people/api_search';
  let response: Response;
  try {
    response = await fetch(buildApolloSearchUrl(options, endpoint), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'x-api-key': apiKey,
      },
    });
  } catch {
    throw new ApolloError('upstream');
  }
  if (response.status === 401 || response.status === 403)
    throw new ApolloError('authentication', response.status);
  if (response.status === 429)
    throw new ApolloError('rate_limit', response.status, response.headers.get('retry-after'));
  if (!response.ok) throw new ApolloError('upstream', response.status);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApolloError('malformed', response.status);
  }
  if (
    !payload ||
    typeof payload !== 'object' ||
    !Array.isArray((payload as { people?: unknown }).people)
  )
    throw new ApolloError('malformed', response.status);
  let data = payload as { people: ApolloPerson[]; total_entries?: number };

  // Fallback 1: If search yielded 0 results, retry without overly restrictive industries & keywords
  if (
    (!data.people || data.people.length === 0) &&
    (options.search.industries?.length || options.search.keywords?.length)
  ) {
    try {
      const fallbackOptions: ApolloSearchOptions = {
        ...options,
        search: {
          ...options.search,
          industries: undefined,
          keywords: undefined,
          keyword_tags: undefined,
        },
      };
      const fallbackRes = await fetch(buildApolloSearchUrl(fallbackOptions, endpoint), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'x-api-key': apiKey,
        },
      });
      if (fallbackRes.ok) {
        const fallbackPayload = (await fallbackRes.json()) as {
          people?: ApolloPerson[];
          total_entries?: number;
        };
        if (Array.isArray(fallbackPayload?.people) && fallbackPayload.people.length > 0) {
          data = fallbackPayload as { people: ApolloPerson[]; total_entries?: number };
        }
      }
    } catch {
      // ignore fallback error and proceed
    }
  }

  // Fallback 2: If still 0 results, retry broadening locations
  if ((!data.people || data.people.length === 0) && options.search.locations?.length) {
    try {
      const broadOptions: ApolloSearchOptions = {
        ...options,
        search: {
          ...options.search,
          industries: undefined,
          keywords: undefined,
          keyword_tags: undefined,
          locations: undefined,
        },
      };
      const broadRes = await fetch(buildApolloSearchUrl(broadOptions, endpoint), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'x-api-key': apiKey,
        },
      });
      if (broadRes.ok) {
        const broadPayload = (await broadRes.json()) as {
          people?: ApolloPerson[];
          total_entries?: number;
        };
        if (Array.isArray(broadPayload?.people) && broadPayload.people.length > 0) {
          data = broadPayload as { people: ApolloPerson[]; total_entries?: number };
        }
      }
    } catch {
      // ignore
    }
  }

  const people = await enrichApolloPeople(data.people, apiKey);
  return {
    people,
    total_entries: typeof data.total_entries === 'number' ? data.total_entries : people.length,
  };
};

const mergePerson = (
  searchPerson: ApolloPerson,
  enrichedPerson: ApolloPerson | null
): ApolloPerson => ({
  ...searchPerson,
  ...enrichedPerson,
  organization: { ...(searchPerson.organization ?? {}), ...(enrichedPerson?.organization ?? {}) },
});

export const enrichApolloPeople = async (
  people: ApolloPerson[],
  apiKey: string
): Promise<ApolloPerson[]> => {
  const enriched = new Map<string, ApolloPerson | null>();
  for (let offset = 0; offset < people.length; offset += 10) {
    const batch = people
      .slice(offset, offset + 10)
      .filter((person): person is ApolloPerson & { id: string } => Boolean(person.id));
    if (!batch.length) continue;
    const endpoint =
      Deno.env.get('APOLLO_ENRICH_URL') ?? 'https://api.apollo.io/api/v1/people/bulk_match';
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({ details: batch.map((person) => ({ id: person.id })) }),
      });
    } catch {
      throw new ApolloError('upstream');
    }
    if (response.status === 401 || response.status === 403)
      throw new ApolloError('authentication', response.status);
    if (response.status === 429)
      throw new ApolloError('rate_limit', response.status, response.headers.get('retry-after'));
    if (!response.ok) throw new ApolloError('upstream', response.status);
    let payload: ApolloBulkMatchResponse;
    try {
      payload = (await response.json()) as ApolloBulkMatchResponse;
    } catch {
      throw new ApolloError('malformed', response.status);
    }
    if (!Array.isArray(payload.matches)) throw new ApolloError('malformed', response.status);
    payload.matches.forEach((person) => {
      if (person?.id) enriched.set(person.id, person);
    });
  }
  return people.map((person) =>
    mergePerson(person, person.id ? (enriched.get(person.id) ?? null) : null)
  );
};
