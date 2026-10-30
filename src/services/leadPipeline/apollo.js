var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var apollo_exports = {};
__export(apollo_exports, {
  ApolloError: () => ApolloError,
  buildApolloSearchUrl: () => buildApolloSearchUrl,
  enrichApolloPeople: () => enrichApolloPeople,
  searchApollo: () => searchApollo
});
module.exports = __toCommonJS(apollo_exports);
class ApolloError extends Error {
  constructor(kind, status, retryAfter) {
    super(`Apollo ${kind} error`);
    this.kind = kind;
    this.status = status;
    this.retryAfter = retryAfter;
  }
  kind;
  status;
  retryAfter;
}
const appendArray = (params, key, values) => {
  values?.forEach((value) => params.append(`${key}[]`, value));
};
const buildApolloSearchUrl = (options, endpoint) => {
  const params = new URLSearchParams({
    page: String(options.page),
    per_page: String(options.per_page)
  });
  const search = options.search;
  appendArray(params, "organization_industries", search.industries);
  appendArray(params, "person_titles", search.job_titles);
  appendArray(params, "person_seniorities", search.seniorities);
  appendArray(params, "person_departments", search.departments);
  appendArray(params, "person_locations", search.locations);
  appendArray(params, "organization_locations", search.locations);
  appendArray(params, "organization_num_employees_ranges", search.employee_ranges);
  appendArray(params, "organization_revenue_ranges", search.revenue_ranges);
  if (search.keywords?.length) params.set("q_keywords", search.keywords.join(" "));
  if (search.keyword_tags?.length)
    appendArray(params, "q_organization_keyword_tags", search.keyword_tags);
  appendArray(params, "q_organization_domains_list", search.company_domains);
  appendArray(params, "not_organization_websites_list", search.exclude_domains);
  appendArray(params, "currently_using_any_of_technology_uids", search.technologies);
  return `${endpoint}?${params.toString()}`;
};
const searchApollo = async (options, apiKey) => {
  const endpoint = process.env.APOLLO_SEARCH_URL ?? "https://api.apollo.io/api/v1/mixed_people/api_search";
  let response;
  try {
    response = await fetch(buildApolloSearchUrl(options, endpoint), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "x-api-key": apiKey
      }
    });
  } catch {
    throw new ApolloError("upstream");
  }
  if (response.status === 401 || response.status === 403)
    throw new ApolloError("authentication", response.status);
  if (response.status === 429)
    throw new ApolloError("rate_limit", response.status, response.headers.get("retry-after"));
  if (!response.ok) throw new ApolloError("upstream", response.status);
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new ApolloError("malformed", response.status);
  }
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.people))
    throw new ApolloError("malformed", response.status);
  let data = payload;
  if ((!data.people || data.people.length === 0) && (options.search.industries?.length || options.search.keywords?.length)) {
    try {
      const fallbackOptions = {
        ...options,
        search: {
          ...options.search,
          industries: void 0,
          keywords: void 0,
          keyword_tags: void 0
        }
      };
      const fallbackRes = await fetch(buildApolloSearchUrl(fallbackOptions, endpoint), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "x-api-key": apiKey
        }
      });
      if (fallbackRes.ok) {
        const fallbackPayload = await fallbackRes.json();
        if (Array.isArray(fallbackPayload?.people) && fallbackPayload.people.length > 0) {
          data = fallbackPayload;
        }
      }
    } catch {
    }
  }
  if ((!data.people || data.people.length === 0) && options.search.locations?.length) {
    try {
      const broadOptions = {
        ...options,
        search: {
          ...options.search,
          industries: void 0,
          keywords: void 0,
          keyword_tags: void 0,
          locations: void 0
        }
      };
      const broadRes = await fetch(buildApolloSearchUrl(broadOptions, endpoint), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "x-api-key": apiKey
        }
      });
      if (broadRes.ok) {
        const broadPayload = await broadRes.json();
        if (Array.isArray(broadPayload?.people) && broadPayload.people.length > 0) {
          data = broadPayload;
        }
      }
    } catch {
    }
  }
  const people = await enrichApolloPeople(data.people, apiKey);
  return {
    people,
    total_entries: typeof data.total_entries === "number" ? data.total_entries : people.length
  };
};
const mergePerson = (searchPerson, enrichedPerson) => ({
  ...searchPerson,
  ...enrichedPerson,
  organization: { ...searchPerson.organization ?? {}, ...enrichedPerson?.organization ?? {} }
});
const enrichApolloPeople = async (people, apiKey) => {
  const enriched = /* @__PURE__ */ new Map();
  for (let offset = 0; offset < people.length; offset += 10) {
    const batch = people.slice(offset, offset + 10).filter((person) => Boolean(person.id));
    if (!batch.length) continue;
    const endpoint = process.env.APOLLO_ENRICH_URL ?? "https://api.apollo.io/api/v1/people/bulk_match";
    let response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "x-api-key": apiKey
        },
        body: JSON.stringify({ details: batch.map((person) => ({ id: person.id })) })
      });
    } catch {
      throw new ApolloError("upstream");
    }
    if (response.status === 401 || response.status === 403)
      throw new ApolloError("authentication", response.status);
    if (response.status === 429)
      throw new ApolloError("rate_limit", response.status, response.headers.get("retry-after"));
    if (!response.ok) throw new ApolloError("upstream", response.status);
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new ApolloError("malformed", response.status);
    }
    if (!Array.isArray(payload.matches)) throw new ApolloError("malformed", response.status);
    payload.matches.forEach((person) => {
      if (person?.id) enriched.set(person.id, person);
    });
  }
  return people.map(
    (person) => mergePerson(person, person.id ? enriched.get(person.id) ?? null : null)
  );
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ApolloError,
  buildApolloSearchUrl,
  enrichApolloPeople,
  searchApollo
});
