import type { ApolloPerson } from './apollo.ts';
import type { LeadClass } from './lead-classes.ts';

export const LEAD_TYPES = [
  'VOLUME',
  'HIGH_TICKET',
  'STRATEGIC_PARTNER',
  'CO_EVENT_COLLABORATOR',
  'RE_ENGAGEMENT',
] as const;
export type LeadType = (typeof LEAD_TYPES)[number];

export interface LeadSearchRequest {
  campaign_id: string;
  search?: Record<string, unknown>;
  page?: number;
  per_page?: number;
  lead_type?: LeadType | null;
  target_segment?: string | null;
}

export interface NormalizedLead {
  campaign_id: string;
  source: 'apollo';
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  job_title: string | null;
  seniority: string | null;
  department: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  timezone: string | null;
  company_name: string | null;
  company_domain: string | null;
  company_linkedin_url: string | null;
  industry: string | null;
  sub_industry: string | null;
  employee_count: number | null;
  revenue_range: string | null;
  company_headquarters: string | null;
  company_description: string | null;
  company_type: string | null;
  technologies: string[];
  apollo_person_id: string | null;
  apollo_company_id: string | null;
  email_verification_status: 'unverified' | 'verified';
  lead_type: LeadType | null;
  /** Business classification, LEAD-01 .. LEAD-06 (see lead-classes.ts) */
  lead_class: LeadClass | null;
  target_segment: string | null;
  qualification_status: 'new';
  priority: string | null;
  /** 0-100 fit score calculated against the category config */
  fit_score: number | null;
  /** One-sentence explanation of what matched */
  fit_reason: string | null;
  metadata: Record<string, unknown>;
  dedupe_key: string;
}

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const normalized = (value: string | null) => value?.trim().toLowerCase() ?? null;

export const normalizeLead = (
  person: ApolloPerson,
  campaignId: string,
  leadType: LeadType | null,
  targetSegment: string | null,
  fitScore: number | null = null,
  fitReason: string | null = null,
  leadClass: LeadClass | null = null
): NormalizedLead => {
  const organization = person.organization;
  const firstName = text(person.first_name);
  const lastName = text(person.last_name) ?? text(person.last_name_obfuscated);
  const fullName = text(person.name) ?? ([firstName, lastName].filter(Boolean).join(' ') || null);
  const email = normalized(text(person.email));
  const linkedinUrl = text(person.linkedin_url);
  const domain = normalized(text(organization?.primary_domain) ?? text(organization?.domain));
  const identity =
    text(person.id) ??
    email ??
    normalized(linkedinUrl) ??
    `${normalized(fullName) ?? 'unknown'}:${domain ?? 'unknown'}`;
  const phone = person.phone_numbers?.find(
    (entry) => text(entry.sanitized_number) ?? text(entry.raw_number)
  );

  return {
    campaign_id: campaignId,
    source: 'apollo',
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
    company_linkedin_url: text(organization?.linkedin_url),
    industry: text(organization?.industry) ?? organization?.industries?.[0] ?? null,
    sub_industry: organization?.secondary_industries?.[0] ?? null,
    employee_count:
      typeof organization?.estimated_num_employees === 'number'
        ? organization.estimated_num_employees
        : null,
    revenue_range:
      text(organization?.annual_revenue_printed) ??
      text(organization?.organization_revenue_printed),
    company_headquarters:
      text(organization?.raw_address) ??
      ([
        organization?.street_address,
        organization?.city,
        organization?.state,
        organization?.country,
      ]
        .filter(Boolean)
        .join(', ') ||
        null),
    company_description: text(organization?.short_description),
    company_type: text(organization?.organization_type),
    technologies:
      organization?.technologies?.filter((value): value is string => typeof value === 'string') ??
      [],
    apollo_person_id: text(person.id),
    apollo_company_id: text(organization?.id),
    email_verification_status: 'unverified',
    lead_type: leadType,
    lead_class: leadClass,
    target_segment: targetSegment,
    qualification_status: 'new',
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
      apollo_email_domain_catchall_verdict: text(person.email_domain_catchall_verdict),
    },
    dedupe_key: `${campaignId}:${identity}`,
  };
};
