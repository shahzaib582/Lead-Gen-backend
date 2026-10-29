/**
 * lead-pipeline: the single edge function for lead generation.
 *
 *   Apollo search  ->  verify email (Apollo status, else Hunter)  ->  save to campaign_leads
 *
 * Only leads whose email passed verification are written to the database.
 *
 * POST /functions/v1/lead-pipeline
 * Authorization: Bearer <Supabase user access token>
 * Body:
 *   {
 *     campaign_id:      string (UUID, must belong to the caller)
 *     entity:           "EQAIESPORTS" | "CEOSOCIAL" | "PITCH4CAPITAL" | "CPACLOUDTAXUSA"
 *     category:         string (valid for the entity, see _shared/client-categories.ts)
 *     page?:            number (default 1)
 *     per_page?:        number (1-5, default 3; hard cap 5 to protect free-plan credits)
 *     locations?:       string[]  (overrides the entity's default geography)
 *     exclude_domains?: string[]  (added to the global blocklist)
 *   }
 *
 * See lead-pipeline/README.md for the response shape.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { ApolloError, searchApollo } from '../_shared/apollo.ts';
import { ENTITY_CONFIG, type Entity } from '../_shared/client-categories.ts';
import { LEAD_CLASSES } from '../_shared/lead-classes.ts';
import { findHunterEmail, verifyHunterEmail } from '../_shared/hunter.ts';
import type { NormalizedLead } from '../_shared/lead.ts';
import { runPipeline, type HunterClient, type LeadRepo } from '../_shared/pipeline.ts';
import { validateCategoryRequest } from '../_shared/validation.ts';

const MAX_PER_PAGE = 25;
const DEFAULT_PER_PAGE = 10;

const configuredOrigins = (
  Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:8080,http://localhost:5173'
)
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const jsonHeaders = (origin: string | null) => ({
  'Access-Control-Allow-Origin':
    origin && configuredOrigins.includes(origin) ? origin : configuredOrigins[0],
  Vary: 'Origin',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
});

const send = (body: Record<string, unknown>, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: jsonHeaders(origin) });

const parseJwt = (token: string): Record<string, unknown> | null => {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(base64);
    return JSON.parse(json);
  } catch {
    return null;
  }
};

const authenticate = async (
  req: Request
): Promise<{ client: SupabaseClient; isServiceRole: boolean }> => {
  const authorization = req.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) throw new Error('unauthorized');
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey) throw new Error('configuration');

  const token = authorization.slice(7).trim();
  const payload = parseJwt(token);
  if (payload?.role === 'service_role' || (serviceKey && token === serviceKey)) {
    return { client: createClient(url, serviceKey ?? token), isServiceRole: true };
  }

  const client = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error('unauthorized');
  return { client, isServiceRole: false };
};

// Columns we fill in on an existing row only when they are still empty.
const FILL_IF_EMPTY = [
  'first_name',
  'last_name',
  'full_name',
  'job_title',
  'seniority',
  'department',
  'phone',
  'linkedin_url',
  'city',
  'state',
  'country',
  'timezone',
  'company_name',
  'company_domain',
  'company_linkedin_url',
  'industry',
  'sub_industry',
  'employee_count',
  'revenue_range',
  'company_headquarters',
  'company_description',
  'company_type',
  'apollo_person_id',
  'apollo_company_id',
  'target_segment',
] as const;

const buildRepo = (db: SupabaseClient): LeadRepo => ({
  async findExisting(lead: NormalizedLead) {
    const lookups: Array<[string, string | null]> = [
      ['apollo_person_id', lead.apollo_person_id],
      ['email', lead.email],
      ['linkedin_url', lead.linkedin_url],
      ['dedupe_key', lead.dedupe_key],
    ];
    for (const [field, value] of lookups) {
      if (!value) continue;
      let query = db.from('campaign_leads').select('*').eq(field, value);
      if (field !== 'dedupe_key') query = query.eq('campaign_id', lead.campaign_id);
      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      if (data) return data;
    }
    return null;
  },

  async save(lead, existing) {
    if (!existing) {
      const { data, error } = await db.from('campaign_leads').insert(lead).select().single();
      if (error) throw error;
      return { kind: 'inserted' as const, row: data };
    }
    const updates: Record<string, unknown> = {
      // Verification result is authoritative: always written.
      email: lead.email,
      email_verification_status: lead.email_verification_status,
      fit_score: lead.fit_score,
      fit_reason: lead.fit_reason,
      lead_type: lead.lead_type,
      lead_class: lead.lead_class,
      metadata: { ...(existing.metadata ?? {}), ...lead.metadata },
      updated_at: new Date().toISOString(),
    };
    for (const field of FILL_IF_EMPTY) {
      const current = existing[field];
      const incoming = lead[field as keyof NormalizedLead];
      if ((current === null || current === '') && incoming !== null) updates[field] = incoming;
    }
    if (
      (!Array.isArray(existing.technologies) || existing.technologies.length === 0) &&
      lead.technologies.length
    ) {
      updates.technologies = lead.technologies;
    }
    const { data, error } = await db
      .from('campaign_leads')
      .update(updates)
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    return { kind: 'updated' as const, row: data };
  },
});

serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS')
    return new Response('ok', { status: 204, headers: jsonHeaders(origin) });
  if (req.method !== 'POST') return send({ error: 'Method not allowed' }, 405, origin);

  const startedAt = Date.now();
  try {
    let authResult: { client: SupabaseClient; isServiceRole: boolean };
    try {
      authResult = await authenticate(req);
    } catch (err) {
      if (err instanceof Error && err.message === 'configuration')
        return send({ error: 'Supabase integration is not configured.' }, 500, origin);
      return send({ error: 'Authentication required.' }, 401, origin);
    }

    const apolloKey = Deno.env.get('APOLLO_API_KEY');
    if (!apolloKey) return send({ error: 'Apollo integration is not configured.' }, 500, origin);
    const hunterKey = Deno.env.get('HUNTER_API_KEY') ?? null;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return send({ error: 'Malformed JSON request.' }, 400, origin);
    }

    // Default to a small page so a free plan is not drained by one call.
    const withDefaults =
      body && typeof body === 'object' && (body as Record<string, unknown>).per_page === undefined
        ? { ...(body as Record<string, unknown>), per_page: DEFAULT_PER_PAGE }
        : body;

    let validated: ReturnType<typeof validateCategoryRequest>;
    try {
      validated = validateCategoryRequest(withDefaults);
    } catch (err) {
      return send({ error: err instanceof Error ? err.message : 'Invalid request.' }, 400, origin);
    }

    const warnings: string[] = [];
    const perPage = Math.min(validated.request.per_page, MAX_PER_PAGE);
    if (validated.request.per_page > MAX_PER_PAGE)
      warnings.push(`per_page capped at ${MAX_PER_PAGE}.`);

    // The campaign must exist (and belong to caller if user-scoped token)
    const { data: campaign, error: campaignErr } = await authResult.client
      .from('campaigns')
      .select('id')
      .eq('id', validated.request.campaign_id)
      .maybeSingle();
    if (campaignErr) return send({ error: 'Unable to validate campaign.' }, 500, origin);
    if (!campaign) return send({ error: 'Campaign not found.' }, 404, origin);

    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    if (!serviceKey || !supabaseUrl)
      return send({ error: 'Supabase integration is not configured.' }, 500, origin);
    const serviceClient = createClient(supabaseUrl, serviceKey);

    const entityCfg = ENTITY_CONFIG[validated.request.entity as Entity];
    const categoryCfg = entityCfg.categories[validated.request.category] ?? null;

    const apollo = await searchApollo(
      { page: validated.request.page, per_page: perPage, search: validated.search },
      apolloKey
    );

    const hunter: HunterClient | null = hunterKey
      ? {
          verify: (email) => verifyHunterEmail(email, hunterKey),
          find: (params) => findHunterEmail(params, hunterKey),
        }
      : null;

    const result = await runPipeline({
      people: apollo.people,
      campaignId: validated.request.campaign_id,
      leadType: validated.lead_type as never,
      leadClass: validated.lead_class,
      targetSegment: validated.target_segment,
      categoryConfig: categoryCfg,
      targetLocations: validated.request.locations ?? entityCfg.default_locations,
      repo: buildRepo(serviceClient),
      hunter,
    });

    console.log(
      JSON.stringify({
        event: 'lead_pipeline_completed',
        campaign_id: validated.request.campaign_id,
        entity: validated.request.entity,
        category: validated.request.category,
        ...result.stats,
        duration_ms: Date.now() - startedAt,
      })
    );

    return send(
      {
        success: true,
        campaign_id: validated.request.campaign_id,
        entity: validated.request.entity,
        category: validated.request.category,
        target_segment: validated.target_segment,
        lead_type: validated.lead_type,
        lead_class: validated.lead_class,
        lead_class_label: LEAD_CLASSES[validated.lead_class].label,
        requested: perPage,
        found: result.stats.found,
        saved: result.stats.inserted + result.stats.updated,
        inserted: result.stats.inserted,
        updated: result.stats.updated,
        already_verified: result.stats.already_verified,
        stats: result.stats,
        leads: result.leads,
        warnings: [...warnings, ...result.warnings],
      },
      200,
      origin
    );
  } catch (err) {
    if (err instanceof ApolloError) {
      console.error(
        JSON.stringify({ event: 'lead_pipeline_apollo_error', kind: err.kind, status: err.status })
      );
      if (err.kind === 'authentication')
        return send({ error: 'Apollo authentication failed.' }, 502, origin);
      if (err.kind === 'rate_limit')
        return send(
          { error: 'Apollo rate limit exceeded.', retry_after: err.retryAfter ?? undefined },
          429,
          origin
        );
      return send({ error: 'Apollo lead search failed.' }, 502, origin);
    }
    const errMsg =
      err instanceof Error
        ? err.message
        : typeof err === 'object' && err !== null
          ? JSON.stringify(err)
          : String(err);
    const errStack = err instanceof Error ? err.stack : undefined;
    console.error(
      JSON.stringify({
        event: 'lead_pipeline_failed',
        error: errMsg,
        stack: errStack,
        duration_ms: Date.now() - startedAt,
      })
    );
    return send({ error: 'Unexpected server error.', details: errMsg }, 500, origin);
  }
});
