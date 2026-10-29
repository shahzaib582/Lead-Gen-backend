/**
 * scoring.ts – pure, side-effect-free fit-scoring helper.
 *
 * Scoring matrix (max 100):
 *   +40  title exact match against category title list
 *   +20  seniority tier  (owner/founder/c_suite > vp > director > manager)
 *   +20  industry or keyword match
 *   +10  location inside target geography
 *   +10  company employee count inside category range
 *
 * fit_reason: one sentence naming the matched domain and title.
 */

import type { CategoryConfig } from './client-categories.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScoreInput {
  /** Job title from Apollo (person.title) */
  job_title: string | null;
  /** Seniority label from Apollo (person.seniority) */
  seniority: string | null;
  /** Company industry from Apollo (organization.industry) */
  industry: string | null;
  /** Company keyword tags (organization.keywords) */
  org_keywords?: string[] | null;
  /** Person state / country string (e.g. "Texas, United States") */
  location: string | null;
  /** Employee count from Apollo */
  employee_count: number | null;
}

export interface FitScore {
  score: number;
  fit_reason: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SENIORITY_SCORES: Record<string, number> = {
  owner: 20,
  founder: 20,
  c_suite: 20,
  vp: 15,
  director: 10,
  manager: 5,
  senior: 3,
  entry: 0,
};

// Apollo seniority labels → our tiers
const SENIORITY_MAP: Record<string, string> = {
  owner: 'owner',
  founder: 'founder',
  c_suite: 'c_suite',
  c_level: 'c_suite',
  cxo: 'c_suite',
  vp: 'vp',
  'vice president': 'vp',
  director: 'director',
  manager: 'manager',
  senior: 'senior',
  'mid-level': 'entry',
  junior: 'entry',
  entry: 'entry',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const normalise = (s: string | null | undefined) => s?.trim().toLowerCase() ?? '';

/** True when employee count falls inside at least one Apollo range bucket. */
function isInsideEmployeeRanges(count: number | null, ranges: string[]): boolean {
  if (count === null || count === undefined) return false;
  return ranges.some((range) => {
    const [minStr, maxStr] = range.split(',');
    const min = parseInt(minStr ?? '0', 10);
    const max = parseInt(maxStr ?? '999999', 10);
    return count >= min && count <= max;
  });
}

/** True when the location string matches any of the target locations
 *  (state-level fuzzy: "Texas" matches "Texas, United States"). */
function isInsideLocations(location: string | null, targets: string[]): boolean {
  if (!location) return false;
  const loc = normalise(location);
  return targets.some((t) => {
    const target = normalise(t);
    return loc.includes(target) || target.includes(loc);
  });
}

// ---------------------------------------------------------------------------
// Main scorer
// ---------------------------------------------------------------------------

/**
 * Pure function – no I/O. Returns a FitScore for a candidate lead against a
 * CategoryConfig.
 *
 * @param input     Lead field values extracted from Apollo data
 * @param config    CategoryConfig looked up from ENTITY_CONFIG
 * @param targetLocations  Effective location list for this search
 */
export function scoreLead(
  input: ScoreInput,
  config: CategoryConfig,
  targetLocations: string[]
): FitScore {
  let score = 0;
  const reasons: string[] = [];

  // ── Title match (+40) ────────────────────────────────────────────────────
  const jobTitleNorm = normalise(input.job_title);
  const matchedTitle = config.titles.find((t) => normalise(t) === jobTitleNorm);
  if (matchedTitle) {
    score += 40;
    reasons.push(`title "${matchedTitle}"`);
  }

  // ── Seniority tier (+20 max) ─────────────────────────────────────────────
  const seniorityNorm = normalise(input.seniority);
  const tier = SENIORITY_MAP[seniorityNorm] ?? null;
  const seniorityPoints = tier ? (SENIORITY_SCORES[tier] ?? 0) : 0;
  if (seniorityPoints > 0) {
    score += seniorityPoints;
    if (!matchedTitle) reasons.push(`seniority "${input.seniority}"`);
  }

  // ── Industry / keyword match (+20) ───────────────────────────────────────
  const industryNorm = normalise(input.industry);
  const matchedIndustry = config.industries.find(
    (i) => normalise(i) === industryNorm || industryNorm.includes(normalise(i))
  );

  const keywordsToCheck = config.keywords;
  const orgKeywordNorms = (input.org_keywords ?? []).map(normalise);
  const matchedKeyword = keywordsToCheck.find((kw) =>
    orgKeywordNorms.some((ok) => ok.includes(normalise(kw)))
  );

  if (matchedIndustry || matchedKeyword) {
    score += 20;
    if (matchedIndustry) reasons.push(`industry "${matchedIndustry}"`);
    else if (matchedKeyword) reasons.push(`keyword "${matchedKeyword}"`);
  }

  // ── Location match (+10) ─────────────────────────────────────────────────
  if (isInsideLocations(input.location, targetLocations)) {
    score += 10;
    reasons.push(`location "${input.location}"`);
  }

  // ── Company size match (+10) ─────────────────────────────────────────────
  const effectiveRanges = config.employee_ranges ?? ['11,50', '51,200', '201,500'];
  if (isInsideEmployeeRanges(input.employee_count, effectiveRanges)) {
    score += 10;
  }

  // ── Build fit_reason ─────────────────────────────────────────────────────
  const fit_reason =
    reasons.length > 0
      ? `Matched on ${reasons.join(', ')} for ${config.label}.`
      : `No strong signal matched for ${config.label}.`;

  return { score: Math.min(score, 100), fit_reason };
}
