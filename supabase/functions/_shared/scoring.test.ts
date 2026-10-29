import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { scoreLead } from './scoring.ts';
import { getCategoryConfig, DEFAULT_LOCATIONS } from './client-categories.ts';

const venueCfg = getCategoryConfig('EQAIESPORTS', 'VENUE')!;
const activationCfg = getCategoryConfig('EQAIESPORTS', 'ACTIVATION_PARTNER')!;
const investorCfg = getCategoryConfig('PITCH4CAPITAL', 'INVESTOR')!;
const ceoFounderCfg = getCategoryConfig('CEOSOCIAL', 'CEO_FOUNDER')!;
const cpaFirmCfg = getCategoryConfig('CPACLOUDTAXUSA', 'CPA_FIRM')!;
const smbClientCfg = getCategoryConfig('CPACLOUDTAXUSA', 'SMB_TAX_CLIENT')!;

// ---------------------------------------------------------------------------
// Title match (+40)
// ---------------------------------------------------------------------------

Deno.test('title exact match scores +40', () => {
  const { score } = scoreLead(
    {
      job_title: 'General Manager',
      seniority: null,
      industry: null,
      location: null,
      employee_count: null,
    },
    venueCfg,
    DEFAULT_LOCATIONS
  );
  assertEquals(score >= 40, true);
});

Deno.test('no title match scores 0 for title component', () => {
  const { score } = scoreLead(
    {
      job_title: 'Data Scientist',
      seniority: null,
      industry: null,
      location: null,
      employee_count: null,
    },
    venueCfg,
    DEFAULT_LOCATIONS
  );
  assertEquals(score < 40, true);
});

// ---------------------------------------------------------------------------
// Seniority (+20 max)
// ---------------------------------------------------------------------------

Deno.test('owner/founder/c_suite seniority scores +20', () => {
  for (const seniority of ['owner', 'founder', 'c_suite']) {
    const { score } = scoreLead(
      { job_title: null, seniority, industry: null, location: null, employee_count: null },
      venueCfg,
      DEFAULT_LOCATIONS
    );
    assertEquals(score, 20, `Expected 20 for seniority=${seniority}`);
  }
});

Deno.test('vp seniority scores +15', () => {
  const { score } = scoreLead(
    { job_title: null, seniority: 'vp', industry: null, location: null, employee_count: null },
    venueCfg,
    DEFAULT_LOCATIONS
  );
  assertEquals(score, 15);
});

Deno.test('director seniority scores +10', () => {
  const { score } = scoreLead(
    {
      job_title: null,
      seniority: 'director',
      industry: null,
      location: null,
      employee_count: null,
    },
    venueCfg,
    DEFAULT_LOCATIONS
  );
  assertEquals(score, 10);
});

// ---------------------------------------------------------------------------
// Industry match (+20)
// ---------------------------------------------------------------------------

Deno.test('industry match scores +20', () => {
  const { score } = scoreLead(
    {
      job_title: null,
      seniority: null,
      industry: 'Entertainment',
      location: null,
      employee_count: null,
    },
    venueCfg,
    DEFAULT_LOCATIONS
  );
  assertEquals(score, 20);
});

Deno.test('industry mismatch scores 0', () => {
  const { score } = scoreLead(
    {
      job_title: null,
      seniority: null,
      industry: 'Agriculture',
      location: null,
      employee_count: null,
    },
    venueCfg,
    DEFAULT_LOCATIONS
  );
  assertEquals(score, 0);
});

// ---------------------------------------------------------------------------
// Location match (+10)
// ---------------------------------------------------------------------------

Deno.test('location inside target geography scores +10', () => {
  const { score } = scoreLead(
    {
      job_title: null,
      seniority: null,
      industry: null,
      location: 'Texas, United States',
      employee_count: null,
    },
    venueCfg,
    DEFAULT_LOCATIONS
  );
  assertEquals(score, 10);
});

Deno.test('location outside target geography scores 0', () => {
  const { score } = scoreLead(
    {
      job_title: null,
      seniority: null,
      industry: null,
      location: 'New York, United States',
      employee_count: null,
    },
    venueCfg,
    DEFAULT_LOCATIONS
  );
  assertEquals(score, 0);
});

// ---------------------------------------------------------------------------
// Employee count match (+10)
// ---------------------------------------------------------------------------

Deno.test('employee count within range scores +10', () => {
  const { score } = scoreLead(
    { job_title: null, seniority: null, industry: null, location: null, employee_count: 50 },
    venueCfg,
    DEFAULT_LOCATIONS
  );
  assertEquals(score, 10);
});

Deno.test('ACTIVATION_PARTNER range 51-10000 scores +10 for count 500', () => {
  const { score } = scoreLead(
    { job_title: null, seniority: null, industry: null, location: null, employee_count: 500 },
    activationCfg,
    DEFAULT_LOCATIONS
  );
  assertEquals(score, 10);
});

Deno.test('employee count outside all ranges scores 0', () => {
  const { score } = scoreLead(
    { job_title: null, seniority: null, industry: null, location: null, employee_count: 50000 },
    venueCfg,
    DEFAULT_LOCATIONS
  );
  assertEquals(score, 0);
});

// ---------------------------------------------------------------------------
// Perfect score (all signals match)
// ---------------------------------------------------------------------------

Deno.test('all signals matched yields score 100', () => {
  const { score, fit_reason } = scoreLead(
    {
      job_title: 'Owner',
      seniority: 'owner',
      industry: 'Entertainment',
      location: 'Arizona, United States',
      employee_count: 25,
    },
    venueCfg,
    DEFAULT_LOCATIONS
  );
  assertEquals(score, 100);
  assertEquals(fit_reason.includes('Owner') || fit_reason.includes('Entertainment'), true);
});

// ---------------------------------------------------------------------------
// fit_reason content
// ---------------------------------------------------------------------------

Deno.test('fit_reason mentions the category label on no-match', () => {
  const { fit_reason } = scoreLead(
    { job_title: null, seniority: null, industry: null, location: null, employee_count: null },
    venueCfg,
    DEFAULT_LOCATIONS
  );
  assertEquals(fit_reason.includes('Venue'), true);
});

// ---------------------------------------------------------------------------
// Per-entity category smoke tests
// ---------------------------------------------------------------------------

Deno.test('PITCH4CAPITAL INVESTOR: Managing Partner c_suite + Venture Capital scores well', () => {
  const { score } = scoreLead(
    {
      job_title: 'Managing Partner',
      seniority: 'c_suite',
      industry: 'Venture Capital & Private Equity',
      location: 'California, United States',
      employee_count: 15,
    },
    investorCfg,
    DEFAULT_LOCATIONS
  );
  assertEquals(score >= 80, true);
});

Deno.test('CEOSOCIAL CEO_FOUNDER: CEO + founder seniority scores well', () => {
  const { score } = scoreLead(
    {
      job_title: 'CEO',
      seniority: 'founder',
      industry: 'Computer Software',
      location: 'Texas, United States',
      employee_count: 30,
    },
    ceoFounderCfg,
    DEFAULT_LOCATIONS
  );
  assertEquals(score >= 80, true);
});

Deno.test('CPACLOUDTAXUSA CPA_FIRM: Managing Partner + Accounting scores well', () => {
  const { score } = scoreLead(
    {
      job_title: 'Managing Partner',
      seniority: 'owner',
      industry: 'Accounting',
      location: 'Nevada, United States',
      employee_count: 10,
    },
    cpaFirmCfg,
    DEFAULT_LOCATIONS
  );
  assertEquals(score >= 80, true);
});

Deno.test('CPACLOUDTAXUSA SMB_TAX_CLIENT: Owner + Retail + small company scores well', () => {
  const { score } = scoreLead(
    {
      job_title: 'Owner',
      seniority: 'owner',
      industry: 'Retail',
      location: 'Arizona, United States',
      employee_count: 8,
    },
    smbClientCfg,
    DEFAULT_LOCATIONS
  );
  assertEquals(score >= 80, true);
});
