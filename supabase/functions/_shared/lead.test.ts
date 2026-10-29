import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { normalizeLead } from './lead.ts';

Deno.test('normalizes a complete Apollo person without inventing values', () => {
  const lead = normalizeLead(
    {
      id: 'person-1',
      first_name: 'Ada',
      last_name: 'Lovelace',
      title: 'Founder',
      email: ' ADA@Example.com ',
      linkedin_url: 'https://linkedin.com/in/ada',
      organization: {
        id: 'company-1',
        name: 'Analytical Engines',
        primary_domain: 'example.com',
        industry: 'Engineering',
        estimated_num_employees: 12,
        technologies: ['crm'],
      },
    },
    '8342fcc0-562f-4e3f-91ad-9e1ba9c9bb35',
    null,
    null
  );
  assertEquals(lead.email, 'ada@example.com');
  assertEquals(lead.company_name, 'Analytical Engines');
  assertEquals(lead.email_verification_status, 'unverified');
  assertEquals(lead.lead_type, null);
});

Deno.test('handles missing optional Apollo data', () => {
  const lead = normalizeLead({}, '8342fcc0-562f-4e3f-91ad-9e1ba9c9bb35', null, null);
  assertEquals(lead.email, null);
  assertEquals(lead.company_name, null);
  assertEquals(lead.full_name, null);
});

Deno.test('normalizes enriched nested Apollo organization data', () => {
  const lead = normalizeLead(
    {
      id: 'person-2',
      first_name: 'Jeff',
      last_name: 'Host',
      linkedin_url: 'https://linkedin.com/in/jeff',
      organization: {
        id: 'company-2',
        name: 'IntelliHost',
        primary_domain: 'intellihost.example',
        linkedin_url: 'https://linkedin.com/company/intellihost',
        industry: 'Hosting',
        estimated_num_employees: 25,
        organization_revenue_printed: '$1M',
        secondary_industries: ['Cloud Services'],
      },
    },
    '8342fcc0-562f-4e3f-91ad-9e1ba9c9bb35',
    null,
    null
  );
  assertEquals(lead.last_name, 'Host');
  assertEquals(lead.company_domain, 'intellihost.example');
  assertEquals(lead.apollo_company_id, 'company-2');
  assertEquals(lead.employee_count, 25);
  assertEquals(lead.sub_industry, 'Cloud Services');
});
