/**
 * lead-classes.ts: the business classification stored on every lead.
 *
 * Why this exists: "lead" alone says nothing about what to do next. The class
 * says what the lead IS to the ecosystem (a workshop attendee, a sponsor, an
 * investor...). It is stored in campaign_leads.lead_class and is independent
 * of lead_type (which is the outreach workflow tag) and of target_segment
 * (entity | category, the exact search that found the lead).
 */

export const LEAD_CLASS_CODES = [
  'LEAD-01',
  'LEAD-02',
  'LEAD-03',
  'LEAD-04',
  'LEAD-05',
  'LEAD-06',
] as const;
export type LeadClass = (typeof LEAD_CLASS_CODES)[number];

export interface LeadClassInfo {
  code: LeadClass;
  label: string;
  description: string;
}

export const LEAD_CLASSES: Record<LeadClass, LeadClassInfo> = {
  'LEAD-01': {
    code: 'LEAD-01',
    label: 'Consumer/Executive Lead',
    description: 'CEO, founder, executive or professional.',
  },
  'LEAD-02': {
    code: 'LEAD-02',
    label: 'Workshop Lead',
    description: 'Someone interested in Lessons/Workshops.',
  },
  'LEAD-03': {
    code: 'LEAD-03',
    label: 'Activation Partner',
    description: 'Potential Bundle Battle / Recall Redux / event partner.',
  },
  'LEAD-04': {
    code: 'LEAD-04',
    label: 'Strategic Partner',
    description: 'Potential ecosystem collaborator.',
  },
  'LEAD-05': {
    code: 'LEAD-05',
    label: 'Enterprise Lead',
    description: 'Company interested in licensing the Federated Ecosystem.',
  },
  'LEAD-06': {
    code: 'LEAD-06',
    label: 'Capital Lead',
    description: 'Investor, lender, capital partner or institutional fund.',
  },
};

export const isLeadClass = (value: unknown): value is LeadClass =>
  typeof value === 'string' && (LEAD_CLASS_CODES as readonly string[]).includes(value);
