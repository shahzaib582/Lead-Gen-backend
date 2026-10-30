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
var validation_exports = {};
__export(validation_exports, {
  validateCategoryRequest: () => validateCategoryRequest,
  validateRequest: () => validateRequest
});
module.exports = __toCommonJS(validation_exports);
var import_lead_classes = require("./leadClasses");
var import_lead = require("./lead");
var import_client_categories = require("./clientCategories");
const SEARCH_FIELDS = [
  "industries",
  "job_titles",
  "seniorities",
  "departments",
  "locations",
  "employee_ranges",
  "revenue_ranges",
  "keywords",
  "keyword_tags",
  "company_domains",
  "technologies",
  "exclude_domains"
];
const validateRequest = (body) => {
  if (!body || typeof body !== "object") throw new Error("Request body must be a JSON object");
  const value = body;
  if (value.page !== void 0 && (!Number.isInteger(value.page) || value.page < 1))
    throw new Error("page must be a positive integer");
  if (value.per_page !== void 0 && (!Number.isInteger(value.per_page) || value.per_page < 1 || value.per_page > 100))
    throw new Error("per_page must be between 1 and 100");
  if (value.search !== void 0 && (!value.search || typeof value.search !== "object" || Array.isArray(value.search)))
    throw new Error("search must be an object");
  const rawSearch = value.search ?? {};
  const search = {};
  for (const field of SEARCH_FIELDS) {
    if (rawSearch[field] !== void 0) {
      if (!Array.isArray(rawSearch[field]) || rawSearch[field].some((item) => typeof item !== "string" || !item.trim()))
        throw new Error(`search.${field} must be an array of non-empty strings`);
      search[field] = rawSearch[field].map((item) => item.trim()).slice(0, 100);
    }
  }
  const existingExcludes = Array.isArray(search.exclude_domains) ? search.exclude_domains : [];
  search.exclude_domains = [.../* @__PURE__ */ new Set([...import_client_categories.GLOBAL_EXCLUDED_DOMAINS, ...existingExcludes])];
  if (value.lead_type !== void 0 && value.lead_type !== null && (typeof value.lead_type !== "string" || !import_lead.LEAD_TYPES.includes(value.lead_type)))
    throw new Error("lead_type is invalid");
  if (value.target_segment !== void 0 && value.target_segment !== null && (typeof value.target_segment !== "string" || value.target_segment.trim().length > 200))
    throw new Error("target_segment is invalid");
  return {
    request: {
      page: value.page ?? 1,
      per_page: value.per_page ?? 25,
      search,
      lead_type: value.lead_type ?? null,
      target_segment: typeof value.target_segment === "string" ? value.target_segment.trim() : null
    },
    search
  };
};
const validateCategoryRequest = (body) => {
  if (!body || typeof body !== "object") throw new Error("Request body must be a JSON object");
  const value = body;
  let reqLeadClass = null;
  if (value.lead_class !== void 0 && value.lead_class !== null) {
    if (!(0, import_lead_classes.isLeadClass)(value.lead_class)) {
      throw new Error(
        `lead_class "${value.lead_class}" is invalid. Valid codes: LEAD-01, LEAD-02, LEAD-03, LEAD-04, LEAD-05, LEAD-06`
      );
    }
    reqLeadClass = value.lead_class;
  }
  if ((!value.entity || typeof value.entity !== "string" || !value.entity.trim()) && reqLeadClass) {
    const defaults = import_client_categories.LEAD_CLASS_DEFAULTS[reqLeadClass];
    value.entity = defaults.entity;
    value.category = defaults.category;
  }
  if (typeof value.entity !== "string" || !value.entity.trim())
    throw new Error("entity is required");
  if (typeof value.category !== "string" || !value.category.trim())
    throw new Error("category is required");
  const categoryCfg = (0, import_client_categories.requireCategoryConfig)(value.entity, value.category);
  if (value.page !== void 0 && (!Number.isInteger(value.page) || value.page < 1))
    throw new Error("page must be a positive integer");
  if (value.per_page !== void 0 && (!Number.isInteger(value.per_page) || value.per_page < 1 || value.per_page > 100))
    throw new Error("per_page must be between 1 and 100");
  let overrideLocations;
  if (value.locations !== void 0) {
    if (!Array.isArray(value.locations) || value.locations.some((l) => typeof l !== "string" || !l.trim()))
      throw new Error("locations must be an array of non-empty strings");
    overrideLocations = value.locations.map((l) => l.trim());
  }
  let extraExcludes = [];
  if (value.exclude_domains !== void 0) {
    if (!Array.isArray(value.exclude_domains) || value.exclude_domains.some((d) => typeof d !== "string" || !d.trim()))
      throw new Error("exclude_domains must be an array of non-empty strings");
    extraExcludes = value.exclude_domains.map((d) => d.trim().toLowerCase());
  }
  const apolloParams = (0, import_client_categories.buildApolloParamsForCategory)(
    value.entity,
    value.category,
    overrideLocations
  );
  const search = {
    industries: apolloParams.industries,
    job_titles: apolloParams.titles,
    keywords: apolloParams.keywords,
    keyword_tags: apolloParams.keywords,
    // also send as keyword_tags for higher-plan support
    employee_ranges: apolloParams.employee_ranges,
    locations: apolloParams.locations,
    exclude_domains: [.../* @__PURE__ */ new Set([...import_client_categories.GLOBAL_EXCLUDED_DOMAINS, ...extraExcludes])]
  };
  const target_segment = (0, import_client_categories.formatTargetSegment)(value.entity, value.category);
  const page = value.page ?? 1;
  const per_page = value.per_page ?? 5;
  return {
    request: {
      entity: value.entity,
      category: value.category,
      lead_class: reqLeadClass ?? categoryCfg.lead_class,
      locations: overrideLocations,
      exclude_domains: extraExcludes,
      page,
      per_page
    },
    search,
    lead_type: categoryCfg.lead_type,
    lead_class: reqLeadClass ?? categoryCfg.lead_class,
    target_segment
  };
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  validateCategoryRequest,
  validateRequest
});
