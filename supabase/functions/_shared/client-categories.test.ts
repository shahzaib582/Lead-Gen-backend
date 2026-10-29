import { assertEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  getCategoryConfig,
  requireCategoryConfig,
  formatTargetSegment,
  parseTargetSegment,
  buildApolloParamsForCategory,
  ENTITY_CONFIG,
  GLOBAL_EXCLUDED_DOMAINS,
  DEFAULT_LOCATIONS,
} from './client-categories.ts';

// ---------------------------------------------------------------------------
// getCategoryConfig
// ---------------------------------------------------------------------------

Deno.test('getCategoryConfig returns config for every registered entity/category', () => {
  const combos: Array<[string, string]> = [
    ['EQAIESPORTS', 'VENUE'],
    ['EQAIESPORTS', 'EVENT_ORGANIZER'],
    ['EQAIESPORTS', 'ACTIVATION_PARTNER'],
    ['EQAIESPORTS', 'COLLEGIATE'],
    ['EQAIESPORTS', 'TEAM_OR_STUDIO'],
    ['PITCH4CAPITAL', 'INVESTOR'],
    ['CEOSOCIAL', 'CEO_FOUNDER'],
    ['CPACLOUDTAXUSA', 'CPA_FIRM'],
    ['CPACLOUDTAXUSA', 'SMB_TAX_CLIENT'],
  ];
  for (const [entity, category] of combos) {
    const cfg = getCategoryConfig(entity, category);
    assertEquals(cfg !== null, true, `Expected config for ${entity}/${category}`);
  }
});

Deno.test('getCategoryConfig returns null for unknown entity', () => {
  assertEquals(getCategoryConfig('UNKNOWN_ENTITY', 'VENUE'), null);
});

Deno.test('getCategoryConfig returns null for unknown category within a valid entity', () => {
  assertEquals(getCategoryConfig('EQAIESPORTS', 'NONEXISTENT'), null);
});

Deno.test('getCategoryConfig rejects cross-entity category combos', () => {
  // INVESTOR belongs to PITCH4CAPITAL, not EQAIESPORTS
  assertEquals(getCategoryConfig('EQAIESPORTS', 'INVESTOR'), null);
  // VENUE belongs to EQAIESPORTS, not CEOSOCIAL
  assertEquals(getCategoryConfig('CEOSOCIAL', 'VENUE'), null);
  // CEO_FOUNDER belongs to CEOSOCIAL, not CPACLOUDTAXUSA
  assertEquals(getCategoryConfig('CPACLOUDTAXUSA', 'CEO_FOUNDER'), null);
});

// ---------------------------------------------------------------------------
// requireCategoryConfig
// ---------------------------------------------------------------------------

Deno.test('requireCategoryConfig throws for unknown entity', () => {
  assertThrows(() => requireCategoryConfig('BAD_ENTITY', 'VENUE'), Error, 'Unknown entity');
});

Deno.test('requireCategoryConfig throws for valid entity but invalid category', () => {
  assertThrows(
    () => requireCategoryConfig('EQAIESPORTS', 'INVESTOR'),
    Error,
    'not valid for entity'
  );
});

Deno.test('requireCategoryConfig returns config for valid combo', () => {
  const cfg = requireCategoryConfig('EQAIESPORTS', 'ACTIVATION_PARTNER');
  assertEquals(cfg.lead_type, 'HIGH_TICKET');
  assertEquals(cfg.employee_ranges?.includes('51,200'), true);
});

// ---------------------------------------------------------------------------
// formatTargetSegment
// ---------------------------------------------------------------------------

Deno.test('formatTargetSegment produces correct pattern', () => {
  assertEquals(formatTargetSegment('EQAIESPORTS', 'VENUE'), 'EQAIESPORTS | VENUE');
  assertEquals(
    formatTargetSegment('CPACLOUDTAXUSA', 'SMB_TAX_CLIENT'),
    'CPACLOUDTAXUSA | SMB_TAX_CLIENT'
  );
});

Deno.test('formatTargetSegment stays within 200 chars for all real combos', () => {
  for (const [entity, entityCfg] of Object.entries(ENTITY_CONFIG)) {
    for (const category of Object.keys(entityCfg.categories)) {
      const seg = formatTargetSegment(entity, category);
      assertEquals(seg.length <= 200, true, `target_segment too long: "${seg}"`);
    }
  }
});

// ---------------------------------------------------------------------------
// parseTargetSegment
// ---------------------------------------------------------------------------

Deno.test('parseTargetSegment round-trips formatTargetSegment', () => {
  const seg = formatTargetSegment('PITCH4CAPITAL', 'INVESTOR');
  const parsed = parseTargetSegment(seg);
  assertEquals(parsed?.entity, 'PITCH4CAPITAL');
  assertEquals(parsed?.category, 'INVESTOR');
});

Deno.test('parseTargetSegment returns null for malformed string', () => {
  assertEquals(parseTargetSegment('EQAIESPORTS'), null);
  assertEquals(parseTargetSegment('EQAIESPORTS|VENUE'), null); // missing spaces around |
});

// ---------------------------------------------------------------------------
// buildApolloParamsForCategory
// ---------------------------------------------------------------------------

Deno.test('buildApolloParamsForCategory uses entity default locations when none overridden', () => {
  const params = buildApolloParamsForCategory('EQAIESPORTS', 'VENUE');
  assertEquals(params.locations, DEFAULT_LOCATIONS);
  assertEquals(params.industries.includes('Entertainment'), true);
  assertEquals(params.titles.includes('General Manager'), true);
});

Deno.test('buildApolloParamsForCategory respects location override', () => {
  const override = ['Florida, United States'];
  const params = buildApolloParamsForCategory('EQAIESPORTS', 'VENUE', override);
  assertEquals(params.locations, override);
});

Deno.test('ACTIVATION_PARTNER uses category employee_range override', () => {
  const params = buildApolloParamsForCategory('EQAIESPORTS', 'ACTIVATION_PARTNER');
  assertEquals(params.employee_ranges.includes('1001,10000'), true);
  // Should NOT include the tiny bucket
  assertEquals(params.employee_ranges.includes('11,50'), false);
});

Deno.test('SMB_TAX_CLIENT uses 1-50 employee range override', () => {
  const params = buildApolloParamsForCategory('CPACLOUDTAXUSA', 'SMB_TAX_CLIENT');
  assertEquals(params.employee_ranges, ['1,10', '11,50']);
});

// ---------------------------------------------------------------------------
// Global exclusions list
// ---------------------------------------------------------------------------

Deno.test('GLOBAL_EXCLUDED_DOMAINS includes all four own domains', () => {
  for (const domain of [
    'eqaiesports.com',
    'ceosocial.io',
    'pitch4capital.com',
    'cpacloudtaxusa.com',
  ]) {
    assertEquals(GLOBAL_EXCLUDED_DOMAINS.includes(domain), true, `Missing domain: ${domain}`);
  }
});
