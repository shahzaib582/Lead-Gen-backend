import { assertEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { validateRequest, validateCategoryRequest } from './validation.ts';
import { GLOBAL_EXCLUDED_DOMAINS } from './client-categories.ts';

const CAMPAIGN_ID = '8342fcc0-562f-4e3f-91ad-9e1ba9c9bb35';

// ---------------------------------------------------------------------------
// validateRequest (legacy raw-Apollo path)
// ---------------------------------------------------------------------------

Deno.test('validates a minimal campaign request', () => {
  const result = validateRequest({ campaign_id: CAMPAIGN_ID });
  assertEquals(result.request.page, 1);
  assertEquals(result.request.per_page, 25);
});

Deno.test('rejects invalid pagination and search arrays', () => {
  assertThrows(() => validateRequest({ campaign_id: CAMPAIGN_ID, page: 0 }));
  assertThrows(() => validateRequest({ campaign_id: CAMPAIGN_ID, per_page: 101 }));
  assertThrows(() =>
    validateRequest({ campaign_id: CAMPAIGN_ID, search: { industries: 'technology' } })
  );
});

Deno.test('validateRequest always injects GLOBAL_EXCLUDED_DOMAINS', () => {
  const { search } = validateRequest({ campaign_id: CAMPAIGN_ID });
  for (const domain of GLOBAL_EXCLUDED_DOMAINS) {
    assertEquals(
      (search.exclude_domains ?? []).includes(domain),
      true,
      `Missing excluded domain: ${domain}`
    );
  }
});

Deno.test('validateRequest merges caller exclude_domains with global list', () => {
  const { search } = validateRequest({
    campaign_id: CAMPAIGN_ID,
    search: { exclude_domains: ['competitor.com'] },
  });
  assertEquals((search.exclude_domains ?? []).includes('competitor.com'), true);
  assertEquals((search.exclude_domains ?? []).includes('eqaiesports.com'), true);
});

// ---------------------------------------------------------------------------
// validateCategoryRequest (category-aware path)
// ---------------------------------------------------------------------------

Deno.test('validateCategoryRequest accepts all valid entity/category combos', () => {
  const combos: Array<[string, string, string]> = [
    ['EQAIESPORTS', 'VENUE', 'CO_EVENT_COLLABORATOR'],
    ['EQAIESPORTS', 'EVENT_ORGANIZER', 'CO_EVENT_COLLABORATOR'],
    ['EQAIESPORTS', 'ACTIVATION_PARTNER', 'HIGH_TICKET'],
    ['EQAIESPORTS', 'COLLEGIATE', 'VOLUME'],
    ['EQAIESPORTS', 'TEAM_OR_STUDIO', 'STRATEGIC_PARTNER'],
    ['PITCH4CAPITAL', 'INVESTOR', 'STRATEGIC_PARTNER'],
    ['CEOSOCIAL', 'CEO_FOUNDER', 'VOLUME'],
    ['CPACLOUDTAXUSA', 'CPA_FIRM', 'STRATEGIC_PARTNER'],
    ['CPACLOUDTAXUSA', 'SMB_TAX_CLIENT', 'VOLUME'],
  ];
  for (const [entity, category, expectedLeadType] of combos) {
    const result = validateCategoryRequest({
      campaign_id: CAMPAIGN_ID,
      entity,
      category,
    });
    assertEquals(result.lead_type, expectedLeadType, `${entity}/${category}`);
    assertEquals(
      result.target_segment,
      `${entity} | ${category}`,
      `target_segment mismatch for ${entity}/${category}`
    );
  }
});

Deno.test('validateCategoryRequest rejects unknown entity', () => {
  assertThrows(
    () =>
      validateCategoryRequest({
        campaign_id: CAMPAIGN_ID,
        entity: 'FAKE_ENTITY',
        category: 'VENUE',
      }),
    Error,
    'Unknown entity'
  );
});

Deno.test('validateCategoryRequest rejects category from wrong entity', () => {
  // INVESTOR belongs to PITCH4CAPITAL, not EQAIESPORTS
  assertThrows(
    () =>
      validateCategoryRequest({
        campaign_id: CAMPAIGN_ID,
        entity: 'EQAIESPORTS',
        category: 'INVESTOR',
      }),
    Error,
    'not valid for entity'
  );
});

Deno.test('validateCategoryRequest rejects valid entity with nonexistent category', () => {
  assertThrows(
    () =>
      validateCategoryRequest({
        campaign_id: CAMPAIGN_ID,
        entity: 'CEOSOCIAL',
        category: 'CPA_FIRM',
      }),
    Error,
    'not valid for entity'
  );
});

Deno.test('validateCategoryRequest target_segment stays within 200 chars', () => {
  const result = validateCategoryRequest({
    campaign_id: CAMPAIGN_ID,
    entity: 'CPACLOUDTAXUSA',
    category: 'SMB_TAX_CLIENT',
  });
  assertEquals(result.target_segment.length <= 200, true);
  assertEquals(result.target_segment, 'CPACLOUDTAXUSA | SMB_TAX_CLIENT');
});

Deno.test('validateCategoryRequest injects GLOBAL_EXCLUDED_DOMAINS into search', () => {
  const result = validateCategoryRequest({
    campaign_id: CAMPAIGN_ID,
    entity: 'EQAIESPORTS',
    category: 'VENUE',
  });
  for (const domain of GLOBAL_EXCLUDED_DOMAINS) {
    assertEquals(
      (result.search.exclude_domains ?? []).includes(domain),
      true,
      `Missing excluded domain: ${domain}`
    );
  }
});

Deno.test('validateCategoryRequest merges caller exclude_domains with global list', () => {
  const result = validateCategoryRequest({
    campaign_id: CAMPAIGN_ID,
    entity: 'EQAIESPORTS',
    category: 'VENUE',
    exclude_domains: ['rival-arena.com'],
  });
  assertEquals((result.search.exclude_domains ?? []).includes('rival-arena.com'), true);
  assertEquals((result.search.exclude_domains ?? []).includes('eqaiesports.com'), true);
});

Deno.test('validateCategoryRequest defaults per_page to 5', () => {
  const result = validateCategoryRequest({
    campaign_id: CAMPAIGN_ID,
    entity: 'PITCH4CAPITAL',
    category: 'INVESTOR',
  });
  assertEquals(result.request.per_page, 5);
});

Deno.test('validateCategoryRequest populates Apollo search fields from category config', () => {
  const result = validateCategoryRequest({
    campaign_id: CAMPAIGN_ID,
    entity: 'EQAIESPORTS',
    category: 'ACTIVATION_PARTNER',
  });
  assertEquals((result.search.industries ?? []).includes('Computer Games'), true);
  assertEquals((result.search.job_titles ?? []).includes('CMO'), true);
  // ACTIVATION_PARTNER overrides employee_ranges to 51–10000
  assertEquals((result.search.employee_ranges ?? []).includes('1001,10000'), true);
});

Deno.test('validateCategoryRequest respects location override', () => {
  const override = ['Florida, United States'];
  const result = validateCategoryRequest({
    campaign_id: CAMPAIGN_ID,
    entity: 'CEOSOCIAL',
    category: 'CEO_FOUNDER',
    locations: override,
  });
  assertEquals(result.search.locations, override);
});
