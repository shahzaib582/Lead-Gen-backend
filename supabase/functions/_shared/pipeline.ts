/**
 * pipeline.ts: pure orchestration for the lead-pipeline edge function.
 *
 * Order of operations for every Apollo person:
 *   1. score fit against the category config
 *   2. drop in-batch duplicates and personal email addresses
 *   3. skip leads that are already saved AND verified (no credits spent)
 *   4. VERIFY the email  (Apollo "verified" status, else Hunter)
 *   5. only if verified: save to campaign_leads
 *
 * Nothing unverified is ever written. All I/O is injected (repo + hunter), so
 * this file has no network or database imports and is unit-tested with fakes.
 */

import type { ApolloPerson } from './apollo.ts';
import type { CategoryConfig } from './client-categories.ts';
import { PERSONAL_EMAIL_DOMAINS } from './client-categories.ts';
import { HunterError, type HunterResult } from './hunter.ts';
import type { LeadClass } from './lead-classes.ts';
import { normalizeLead, type LeadType, type NormalizedLead } from './lead.ts';
import { scoreLead } from './scoring.ts';

export interface LeadRepo {
  findExisting(lead: NormalizedLead): Promise<Record<string, unknown> | null>;
  /** Insert a new row, or patch blanks on `existing`. Always sets verification fields. */
  save(
    lead: NormalizedLead,
    existing: Record<string, unknown> | null
  ): Promise<{ kind: 'inserted' | 'updated'; row: Record<string, unknown> }>;
}

export interface HunterClient {
  verify(email: string): Promise<HunterResult>;
  find(params: Record<string, string>): Promise<HunterResult>;
}

export interface PipelineInput {
  people: ApolloPerson[];
  campaignId: string;
  leadType: LeadType | null;
  leadClass: LeadClass | null;
  targetSegment: string | null;
  categoryConfig: CategoryConfig | null;
  targetLocations: string[];
  repo: LeadRepo;
  /** null when HUNTER_API_KEY is not configured */
  hunter: HunterClient | null;
  now?: () => string;
}

export interface PipelineStats {
  found: number;
  inserted: number;
  updated: number;
  already_verified: number;
  verified_by_apollo: number;
  verified_by_hunter: number;
  rejected_no_email: number;
  rejected_personal_email: number;
  rejected_unverified: number;
  rejected_hunter_error: number;
  hunter_calls: number;
}

export interface PipelineResult {
  leads: Record<string, unknown>[];
  stats: PipelineStats;
  warnings: string[];
}

export const isPersonalEmail = (email: string | null | undefined): boolean => {
  if (!email) return false;
  const domain = email.split('@')[1]?.toLowerCase();
  return !!domain && PERSONAL_EMAIL_DOMAINS.includes(domain);
};

const stripInternal = (row: Record<string, unknown>) => {
  const { dedupe_key: _dedupe, ...safe } = row;
  return safe;
};

type Verdict =
  | { ok: true; email: string; by: 'apollo' | 'hunter'; hunter?: HunterResult }
  | { ok: false; reason: 'no_email' | 'personal_email' | 'unverified' | 'hunter_error' };

export const runPipeline = async (input: PipelineInput): Promise<PipelineResult> => {
  const now = input.now ?? (() => new Date().toISOString());
  const stats: PipelineStats = {
    found: input.people.length,
    inserted: 0,
    updated: 0,
    already_verified: 0,
    verified_by_apollo: 0,
    verified_by_hunter: 0,
    rejected_no_email: 0,
    rejected_personal_email: 0,
    rejected_unverified: 0,
    rejected_hunter_error: 0,
    hunter_calls: 0,
  };
  const warnings: string[] = [];
  const leads: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  // Set to true after a Hunter auth/rate-limit error so we stop spending calls.
  let hunterDisabled = false;
  if (!input.hunter) {
    warnings.push(
      'Hunter is not configured: only emails Apollo already marks as verified can be saved.'
    );
  }

  const verify = async (lead: NormalizedLead): Promise<Verdict> => {
    const apolloStatus = (lead.metadata.apollo_email_status as string | null) ?? null;

    // Cheapest path: Apollo already verified this address, no Hunter credit needed.
    if (lead.email && apolloStatus === 'verified') {
      return { ok: true, email: lead.email, by: 'apollo' };
    }

    let hunterFailed = false;
    if (input.hunter && !hunterDisabled) {
      try {
        let email = lead.email;
        if (!email) {
          const params: Record<string, string> = {};
          if (lead.first_name) params.first_name = lead.first_name;
          if (lead.last_name) params.last_name = lead.last_name;
          if (lead.company_domain) params.domain = lead.company_domain;
          else if (lead.company_name) params.company = lead.company_name;
          if (params.first_name && params.last_name && (params.domain || params.company)) {
            stats.hunter_calls++;
            const found = await input.hunter.find(params);
            if (found.email) email = found.email.toLowerCase();
          }
        }
        if (email && !isPersonalEmail(email)) {
          stats.hunter_calls++;
          const result = await input.hunter.verify(email);
          if (result.status === 'verified') {
            return {
              ok: true,
              email: (result.email ?? email).toLowerCase(),
              by: 'hunter',
              hunter: result,
            };
          }
        }
      } catch (err) {
        hunterFailed = true;
        if (err instanceof HunterError) {
          if (err.kind === 'authentication' || err.kind === 'rate_limit') {
            hunterDisabled = true;
            warnings.push(`Hunter ${err.kind} error: remaining leads skipped.`);
          } else {
            warnings.push(`Hunter ${err.kind} error for one lead: skipped.`);
          }
        } else {
          warnings.push('Hunter lookup failed for one lead: skipped.');
        }
      }
    }

    if (hunterFailed) return { ok: false, reason: 'hunter_error' };
    return { ok: false, reason: lead.email ? 'unverified' : 'no_email' };
  };

  for (const person of input.people) {
    let fitScore: number | null = null;
    let fitReason: string | null = null;
    if (input.categoryConfig) {
      const scored = scoreLead(
        {
          job_title: typeof person.title === 'string' ? person.title : null,
          seniority: typeof person.seniority === 'string' ? person.seniority : null,
          industry:
            typeof person.organization?.industry === 'string' ? person.organization.industry : null,
          org_keywords: person.organization?.keywords ?? null,
          location: [person.state, person.country].filter(Boolean).join(', ') || null,
          employee_count:
            typeof person.organization?.estimated_num_employees === 'number'
              ? person.organization.estimated_num_employees
              : null,
        },
        input.categoryConfig,
        input.targetLocations
      );
      fitScore = scored.score;
      fitReason = scored.fit_reason;
    }

    const lead = normalizeLead(
      person,
      input.campaignId,
      input.leadType,
      input.targetSegment,
      fitScore,
      fitReason,
      input.leadClass
    );
    if (seen.has(lead.dedupe_key)) continue;
    seen.add(lead.dedupe_key);

    if (isPersonalEmail(lead.email)) {
      stats.rejected_personal_email++;
      continue;
    }

    // Already saved and verified: return as-is, spend nothing.
    const existing = await input.repo.findExisting(lead);
    if (existing && existing.email_verification_status === 'verified' && existing.email) {
      stats.already_verified++;
      leads.push(stripInternal(existing));
      continue;
    }

    const verdict = await verify(lead);
    if (!verdict.ok) {
      if (verdict.reason === 'no_email') stats.rejected_no_email++;
      else if (verdict.reason === 'personal_email') stats.rejected_personal_email++;
      else if (verdict.reason === 'hunter_error') stats.rejected_hunter_error++;
      else stats.rejected_unverified++;
      continue;
    }

    if (verdict.by === 'apollo') stats.verified_by_apollo++;
    else stats.verified_by_hunter++;

    lead.email = verdict.email;
    lead.email_verification_status = 'verified';
    lead.metadata = {
      ...lead.metadata,
      verification: {
        verified_by: verdict.by,
        verified_at: now(),
        ...(verdict.hunter
          ? {
              hunter: {
                status: verdict.hunter.status,
                score: verdict.hunter.score,
                request_type: verdict.hunter.request_type,
              },
            }
          : {}),
      },
    };

    const saved = await input.repo.save(lead, existing);
    if (saved.kind === 'inserted') stats.inserted++;
    else stats.updated++;
    leads.push(stripInternal(saved.row));
  }

  const unsaved =
    stats.rejected_no_email +
    stats.rejected_personal_email +
    stats.rejected_unverified +
    stats.rejected_hunter_error;
  if (unsaved > 0) {
    warnings.push(
      `${unsaved} of ${stats.found} Apollo results were not saved because no verified email was found.`
    );
  }

  return { leads, stats, warnings };
};
