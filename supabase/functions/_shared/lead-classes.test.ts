import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { ENTITY_CONFIG } from './client-categories.ts';
import { LEAD_CLASS_CODES, LEAD_CLASSES, isLeadClass, type LeadClass } from './lead-classes.ts';
import { validateCategoryRequest } from './validation.ts';

const CAMPAIGN = '11111111-1111-4111-8111-111111111111';

const allCategories = () =>
  Object.entries(ENTITY_CONFIG).flatMap(([entity, cfg]) =>
    Object.entries(cfg.categories).map(([category, c]) => ({ entity, category, cfg: c! }))
  );

Deno.test('there are exactly six lead classes, LEAD-01 to LEAD-06, each with a label', () => {
  assertEquals(
    [...LEAD_CLASS_CODES],
    ['LEAD-01', 'LEAD-02', 'LEAD-03', 'LEAD-04', 'LEAD-05', 'LEAD-06']
  );
  for (const code of LEAD_CLASS_CODES) {
    assertEquals(LEAD_CLASSES[code].code, code);
    assertEquals(LEAD_CLASSES[code].label.length > 0, true);
  }
  assertEquals(LEAD_CLASSES['LEAD-06'].label, 'Capital Lead');
});

Deno.test('every category is assigned a valid lead class', () => {
  for (const { entity, category, cfg } of allCategories()) {
    assertEquals(
      isLeadClass(cfg.lead_class),
      true,
      `${entity} | ${category} has no valid lead_class`
    );
  }
});

Deno.test('every lead class can be found through at least one category', () => {
  const covered = new Set<LeadClass>(allCategories().map((c) => c.cfg.lead_class));
  for (const code of LEAD_CLASS_CODES) {
    assertEquals(covered.has(code), true, `${code} has no category that produces it`);
  }
});

Deno.test('category to class mapping', () => {
  const expected: Record<string, LeadClass> = {
    'EQAIESPORTS | VENUE': 'LEAD-03',
    'EQAIESPORTS | EVENT_ORGANIZER': 'LEAD-03',
    'EQAIESPORTS | ACTIVATION_PARTNER': 'LEAD-03',
    'EQAIESPORTS | COLLEGIATE': 'LEAD-02',
    'EQAIESPORTS | TEAM_OR_STUDIO': 'LEAD-04',
    'EQAIESPORTS | ENTERPRISE_LICENSE': 'LEAD-05',
    'PITCH4CAPITAL | INVESTOR': 'LEAD-06',
    'CEOSOCIAL | CEO_FOUNDER': 'LEAD-01',
    'CPACLOUDTAXUSA | CPA_FIRM': 'LEAD-04',
    'CPACLOUDTAXUSA | SMB_TAX_CLIENT': 'LEAD-01',
  };
  const actual = Object.fromEntries(
    allCategories().map((c) => [`${c.entity} | ${c.category}`, c.cfg.lead_class])
  );
  assertEquals(actual, expected);
});

Deno.test('validated request carries the lead class of its category', () => {
  const out = validateCategoryRequest({
    campaign_id: CAMPAIGN,
    entity: 'PITCH4CAPITAL',
    category: 'INVESTOR',
  });
  assertEquals(out.lead_class, 'LEAD-06');
  assertEquals(out.target_segment, 'PITCH4CAPITAL | INVESTOR');
});

Deno.test('the new enterprise category validates and targets enterprise-size companies', () => {
  const out = validateCategoryRequest({
    campaign_id: CAMPAIGN,
    entity: 'EQAIESPORTS',
    category: 'ENTERPRISE_LICENSE',
  });
  assertEquals(out.lead_class, 'LEAD-05');
  assertEquals(out.search.employee_ranges, ['201,500', '501,1000', '1001,10000']);
});
