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
var lead_exports = {};
__export(lead_exports, {
  LEAD_TYPES: () => LEAD_TYPES,
  normalizeLead: () => normalizeLead
});
module.exports = __toCommonJS(lead_exports);
const LEAD_TYPES = [
  "VOLUME",
  "HIGH_TICKET",
  "STRATEGIC_PARTNER",
  "CO_EVENT_COLLABORATOR",
  "RE_ENGAGEMENT"
];
const text = (value) => typeof value === "string" && value.trim() ? value.trim() : null;
const normalized = (value) => value?.trim().toLowerCase() ?? null;
const normalizeLead = (person, campaignId, leadType, targetSegment, fitScore = null, fitReason = null, leadClass = null) => {
  const organization = person.organization;
  const firstName = text(person.first_name);
  const lastName = text(person.last_name) ?? text(person.last_name_obfuscated);
  const fullName = text(person.name) ?? ([firstName, lastName].filter(Boolean).join(" ") || null);
  const email = normalized(text(person.email));
  const linkedinUrl = text(person.linkedin_url);
  const domain = normalized(text(organization?.primary_domain) ?? text(organization?.domain));
  const identity = text(person.id) ?? email ?? normalized(linkedinUrl) ?? `${normalized(fullName) ?? "unknown"}:${domain ?? "unknown"}`;
  const phone = person.phone_numbers?.find(
    (entry) => text(entry.sanitized_number) ?? text(entry.raw_number)
  );
  return {
    campaign_id: campaignId,
    source: "apollo",
    first_name: firstName,
    last_name: lastName,
    full_name: fullName,
    job_title: text(person.title),
    seniority: text(person.seniority),
    department: person.departments?.[0] ?? person.functions?.[0] ?? null,
    email,
    phone: text(phone?.sanitized_number) ?? text(phone?.raw_number),
    linkedin_url: linkedinUrl,
    city: text(person.city),
    state: text(person.state),
    country: text(person.country),
    timezone: text(person.timezone) ?? text(person.time_zone),
    company_name: text(organization?.name),
    company_domain: domain,
    company_city: text(organization?.city),
    company_state: text(organization?.state),
    company_phone: text(organization?.phone) ?? text(organization?.sanitized_phone) ?? text(organization?.primary_phone?.number) ?? text(organization?.primary_phone?.sanitized_number),
    company_linkedin_url: text(organization?.linkedin_url),
    industry: text(organization?.industry) ?? organization?.industries?.[0] ?? null,
    sub_industry: organization?.secondary_industries?.[0] ?? null,
    employee_count: typeof organization?.estimated_num_employees === "number" ? organization.estimated_num_employees : null,
    revenue_range: text(organization?.annual_revenue_printed) ?? text(organization?.organization_revenue_printed),
    company_headquarters: text(organization?.raw_address) ?? ([
      organization?.street_address,
      organization?.city,
      organization?.state,
      organization?.country
    ].filter(Boolean).join(", ") || null),
    company_description: text(organization?.short_description),
    company_type: text(organization?.organization_type),
    technologies: organization?.technologies?.filter((value) => typeof value === "string") ?? [],
    apollo_person_id: text(person.id),
    apollo_company_id: text(organization?.id),
    email_verification_status: "unverified",
    lead_type: leadType,
    lead_class: leadClass,
    target_segment: targetSegment,
    qualification_status: "new",
    priority: null,
    fit_score: fitScore,
    fit_reason: fitReason,
    metadata: {
      lead_class: leadClass,
      lead_type: leadType,
      apollo_last_refreshed_at: text(person.last_refreshed_at),
      apollo_headline: text(person.headline),
      apollo_email_status: text(person.email_status),
      apollo_match_confidence: text(person.match_confidence),
      apollo_email_domain_catchall_verdict: text(person.email_domain_catchall_verdict)
    },
    dedupe_key: identity
  };
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  LEAD_TYPES,
  normalizeLead
});
