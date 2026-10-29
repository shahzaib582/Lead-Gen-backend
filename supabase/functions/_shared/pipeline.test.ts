import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { ApolloPerson } from './apollo.ts';
import { getCategoryConfig, DEFAULT_LOCATIONS } from './client-categories.ts';
import { HunterError, type HunterResult } from './hunter.ts';
import type { NormalizedLead } from './lead.ts';
import { runPipeline, type HunterClient, type LeadRepo } from './pipeline.ts';

const CAMPAIGN = '11111111-1111-4111-8111-111111111111';
const category = getCategoryConfig('EQAIESPORTS', 'VENUE')!;

const person = (id: string, over: Partial<ApolloPerson> = {}): ApolloPerson => ({
  id,
  first_name: `First${id}`,
  last_name: `Last${id}`,
  title: 'General Manager',
  seniority: 'manager',
  email: `p${id}@arena${id}.com`,
  email_status: 'verified',
  state: 'Arizona',
  country: 'United States',
  organization: {
    id: `o${id}`,
    name: `Arena ${id}`,
    primary_domain: `arena${id}.com`,
    industry: 'Entertainment',
  },
  ...over,
});

class FakeRepo implements LeadRepo {
  rows: Record<string, unknown>[] = [];
  saves = 0;
  constructor(seed: Record<string, unknown>[] = []) {
    this.rows = seed;
  }
  findExisting(lead: NormalizedLead) {
    const hit = this.rows.find(
      (r) => r.apollo_person_id === lead.apollo_person_id || (lead.email && r.email === lead.email)
    );
    return Promise.resolve(hit ?? null);
  }
  save(lead: NormalizedLead, existing: Record<string, unknown> | null) {
    this.saves++;
    if (existing) {
      Object.assign(existing, {
        email: lead.email,
        email_verification_status: lead.email_verification_status,
        fit_score: lead.fit_score,
        metadata: { ...(existing.metadata as object), ...lead.metadata },
      });
      return Promise.resolve({ kind: 'updated' as const, row: existing });
    }
    const row = { id: `row-${this.rows.length + 1}`, ...lead } as Record<string, unknown>;
    this.rows.push(row);
    return Promise.resolve({ kind: 'inserted' as const, row });
  }
}

const hunterResult = (over: Partial<HunterResult>): HunterResult => ({
  email: null,
  status: 'unverified',
  score: null,
  sources: [],
  request_type: 'verification',
  ...over,
});

class FakeHunter implements HunterClient {
  verifyCalls: string[] = [];
  findCalls = 0;
  constructor(
    private verifyImpl: (email: string) => HunterResult | Error,
    private findImpl: () => HunterResult | Error = () =>
      hunterResult({ email: null, request_type: 'discovery' })
  ) {}
  verify(email: string) {
    this.verifyCalls.push(email);
    const out = this.verifyImpl(email);
    return out instanceof Error ? Promise.reject(out) : Promise.resolve(out);
  }
  find() {
    this.findCalls++;
    const out = this.findImpl();
    return out instanceof Error ? Promise.reject(out) : Promise.resolve(out);
  }
}

const run = (people: ApolloPerson[], repo: LeadRepo, hunter: HunterClient | null) =>
  runPipeline({
    people,
    campaignId: CAMPAIGN,
    leadType: 'CO_EVENT_COLLABORATOR',
    leadClass: 'LEAD-03',
    targetSegment: 'EQAIESPORTS | VENUE',
    categoryConfig: category,
    targetLocations: DEFAULT_LOCATIONS,
    repo,
    hunter,
    now: () => '2026-10-06T00:00:00.000Z',
  });

Deno.test('Apollo-verified email is saved without spending a Hunter call', async () => {
  const repo = new FakeRepo();
  const hunter = new FakeHunter(() => new Error('must not be called'));
  const out = await run([person('1')], repo, hunter);
  assertEquals(out.stats.inserted, 1);
  assertEquals(out.stats.verified_by_apollo, 1);
  assertEquals(out.stats.hunter_calls, 0);
  assertEquals(hunter.verifyCalls.length, 0);
  const saved = repo.rows[0];
  assertEquals(saved.email_verification_status, 'verified');
  assertEquals((saved.metadata as any).verification.verified_by, 'apollo');
  assertEquals(typeof saved.fit_score, 'number');
  assertEquals(saved.lead_class, 'LEAD-03');
});

Deno.test('unverified Apollo email is verified by Hunter and saved only when valid', async () => {
  const repo = new FakeRepo();
  const hunter = new FakeHunter((email) =>
    hunterResult({ email, status: email.startsWith('good') ? 'verified' : 'invalid', score: 90 })
  );
  const people = [
    person('1', { email: 'good@arena1.com', email_status: 'unavailable' }),
    person('2', { email: 'bad@arena2.com', email_status: 'unavailable' }),
  ];
  const out = await run(people, repo, hunter);
  assertEquals(out.stats.verified_by_hunter, 1);
  assertEquals(out.stats.rejected_unverified, 1);
  assertEquals(repo.rows.length, 1);
  assertEquals(repo.rows[0].email, 'good@arena1.com');
  assertEquals((repo.rows[0].metadata as any).verification.hunter.status, 'verified');
});

Deno.test('risky and unknown Hunter results are never saved', async () => {
  const repo = new FakeRepo();
  const hunter = new FakeHunter((email) =>
    hunterResult({ email, status: email.startsWith('r') ? 'risky' : 'unknown' })
  );
  const out = await run(
    [
      person('1', { email: 'risky@a1.com', email_status: null }),
      person('2', { email: 'unk@a2.com', email_status: null }),
    ],
    repo,
    hunter
  );
  assertEquals(repo.saves, 0);
  assertEquals(out.stats.rejected_unverified, 2);
  assertEquals(out.leads.length, 0);
});

Deno.test(
  'missing email: Hunter discovery then verification, discovered email is saved',
  async () => {
    const repo = new FakeRepo();
    const hunter = new FakeHunter(
      (email) => hunterResult({ email, status: 'verified' }),
      () => hunterResult({ email: 'Found@Arena1.com', request_type: 'discovery' })
    );
    const out = await run([person('1', { email: null, email_status: null })], repo, hunter);
    assertEquals(out.stats.hunter_calls, 2);
    assertEquals(repo.rows[0].email, 'found@arena1.com');
    assertEquals(out.stats.inserted, 1);
  }
);

Deno.test('missing email that Hunter cannot find is rejected, not saved', async () => {
  const repo = new FakeRepo();
  const hunter = new FakeHunter(() => new Error('not reached'));
  const out = await run([person('1', { email: null, email_status: null })], repo, hunter);
  assertEquals(out.stats.rejected_no_email, 1);
  assertEquals(repo.saves, 0);
});

Deno.test('personal email addresses are dropped before any credit is spent', async () => {
  const repo = new FakeRepo();
  const hunter = new FakeHunter(() => new Error('not reached'));
  const out = await run([person('1', { email: 'someone@gmail.com' })], repo, hunter);
  assertEquals(out.stats.rejected_personal_email, 1);
  assertEquals(out.stats.hunter_calls, 0);
  assertEquals(repo.saves, 0);
});

Deno.test(
  'leads already saved and verified are returned without verifying or re-saving',
  async () => {
    const repo = new FakeRepo([
      {
        id: 'existing',
        apollo_person_id: '1',
        email: 'p1@arena1.com',
        email_verification_status: 'verified',
        dedupe_key: 'x',
      },
    ]);
    const hunter = new FakeHunter(() => new Error('not reached'));
    const out = await run([person('1', { email_status: null })], repo, hunter);
    assertEquals(out.stats.already_verified, 1);
    assertEquals(out.stats.hunter_calls, 0);
    assertEquals(repo.saves, 0);
    assertEquals(out.leads.length, 1);
    assertEquals('dedupe_key' in out.leads[0], false);
  }
);

Deno.test('an existing unverified row is updated once its email verifies', async () => {
  const repo = new FakeRepo([
    {
      id: 'existing',
      apollo_person_id: '1',
      email: 'p1@arena1.com',
      email_verification_status: 'unverified',
      metadata: {},
    },
  ]);
  const out = await run([person('1')], repo, null);
  assertEquals(out.stats.updated, 1);
  assertEquals(repo.rows[0].email_verification_status, 'verified');
});

Deno.test(
  'Hunter rate limit stops further Hunter calls and saves nothing it could not verify',
  async () => {
    const repo = new FakeRepo();
    const hunter = new FakeHunter(() => new HunterError('rate_limit', 429));
    const people = [1, 2, 3].map((n) => person(String(n), { email_status: null }));
    const out = await run(people, repo, hunter);
    assertEquals(hunter.verifyCalls.length, 1);
    assertEquals(repo.saves, 0);
    assertEquals(out.stats.rejected_hunter_error, 1);
    assertEquals(out.stats.rejected_unverified, 2);
    assertEquals(
      out.warnings.some((w) => w.includes('rate_limit')),
      true
    );
  }
);

Deno.test(
  'without a Hunter key only Apollo-verified emails are saved, with a warning',
  async () => {
    const repo = new FakeRepo();
    const out = await run([person('1'), person('2', { email_status: 'unavailable' })], repo, null);
    assertEquals(repo.rows.length, 1);
    assertEquals(out.stats.rejected_unverified, 1);
    assertEquals(
      out.warnings.some((w) => w.includes('Hunter is not configured')),
      true
    );
  }
);

Deno.test('duplicate people in one batch are processed once', async () => {
  const repo = new FakeRepo();
  const out = await run([person('1'), person('1')], repo, null);
  assertEquals(out.stats.inserted, 1);
  assertEquals(repo.saves, 1);
});
