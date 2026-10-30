const supabase = require('../../config/supabase');
const AppError = require('../../utils/AppError');
const {
  PIPELINE_TO_LEADS_DATA,
  TEXT_COLUMNS,
  JSON_COLUMNS,
  MIGRATION_COLUMNS,
} = require('./leadsDataColumns');

function isVerifiedStatus(status) {
  return String(status || '')
    .trim()
    .toLowerCase() === 'verified';
}

function asText(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function asJson(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value) && value.length === 0) return null;
  return value;
}

function isUnknownColumnError(error) {
  const message = String(error?.message || '');
  return error?.code === 'PGRST204' || /could not find the ['"]?.+['"]? column/i.test(message);
}

function withoutMigrationColumns(payload) {
  const next = { ...payload };
  for (const key of MIGRATION_COLUMNS) delete next[key];
  return next;
}

function mapPipelineValue(column, value) {
  if (TEXT_COLUMNS.has(column)) return asText(value);
  if (JSON_COLUMNS.has(column)) return asJson(value);
  return value ?? null;
}

function toPipelineRow(row) {
  if (!row) return null;
  return {
    ...row,
    email: row.email || null,
    email_verification_status: isVerifiedStatus(row.emailStatus) ? 'verified' : 'unverified',
  };
}

function toLeadsDataPayload(lead) {
  const verifiedBy = lead.metadata?.verification?.verified_by || 'apollo';
  const payload = {};

  for (const [pipelineKey, column] of Object.entries(PIPELINE_TO_LEADS_DATA)) {
    payload[column] = mapPipelineValue(column, lead[pipelineKey]);
  }

  payload.emailStatus = 'verified';
  payload.emailSource = verifiedBy;
  payload.dateAdded = new Date().toISOString().slice(0, 10);
  payload.source = payload.source || 'apollo';
  payload.companyPhone = asText(lead.company_phone) || payload.phone;
  payload.companyCity = asText(lead.company_city) || payload.city;
  payload.compantyState = asText(lead.company_state);

  return payload;
}

const FILL_IF_EMPTY = Object.entries(PIPELINE_TO_LEADS_DATA).map(([pipelineKey, column]) => [
  column,
  pipelineKey,
]);

async function insertLead(payload) {
  let { data, error } = await supabase.from('leads_data').insert(payload).select('*').single();
  if (error && isUnknownColumnError(error)) {
    ({ data, error } = await supabase
      .from('leads_data')
      .insert(withoutMigrationColumns(payload))
      .select('*')
      .single());
  }
  if (!error) return data;

  if (error.code !== '23505') {
    throw new AppError(error.message || 'Failed to save lead.', 500);
  }

  const { data: maxRows, error: maxErr } = await supabase
    .from('leads_data')
    .select('id')
    .order('id', { ascending: false })
    .limit(1);

  if (maxErr) throw new AppError(maxErr.message || 'Failed to save lead.', 500);

  const maxId = Number(maxRows?.[0]?.id || 0);
  let retryPayload = { ...payload, id: maxId + 1 };
  let retry = await supabase.from('leads_data').insert(retryPayload).select('*').single();
  if (retry.error && isUnknownColumnError(retry.error)) {
    retryPayload = { ...withoutMigrationColumns(payload), id: maxId + 1 };
    retry = await supabase.from('leads_data').insert(retryPayload).select('*').single();
  }
  if (retry.error) throw new AppError(retry.error.message || 'Failed to save lead.', 500);
  return retry.data;
}

function createLeadsDataRepo() {
  return {
    async findExisting(lead) {
      if (lead.email) {
        const { data, error } = await supabase
          .from('leads_data')
          .select('*')
          .eq('email', lead.email)
          .limit(1)
          .maybeSingle();
        if (error) throw new AppError(error.message || 'Failed to look up lead.', 500);
        if (data) return toPipelineRow(data);
      }

      if (lead.linkedin_url) {
        const { data, error } = await supabase
          .from('leads_data')
          .select('*')
          .eq('linkedin', lead.linkedin_url)
          .limit(1)
          .maybeSingle();
        if (error) throw new AppError(error.message || 'Failed to look up lead.', 500);
        if (data) return toPipelineRow(data);
      }

      if (lead.apollo_person_id) {
        const { data, error } = await supabase
          .from('leads_data')
          .select('*')
          .eq('apolloPersonId', lead.apollo_person_id)
          .limit(1)
          .maybeSingle();
        if (error) throw new AppError(error.message || 'Failed to look up lead.', 500);
        if (data) return toPipelineRow(data);
      }

      return null;
    },

    async save(lead, existing) {
      if (!existing) {
        const row = await insertLead(toLeadsDataPayload(lead));
        return { kind: 'inserted', row: toPipelineRow(row) };
      }

      const incoming = toLeadsDataPayload(lead);
      const updates = {
        email: incoming.email,
        emailStatus: 'verified',
        fitScore: incoming.fitScore,
        fitReason: incoming.fitReason,
        fitTag: incoming.fitTag,
        emailSource: incoming.emailSource,
        source: incoming.source,
        leadType: incoming.leadType,
        metadata: incoming.metadata || existing.metadata || null,
      };

      for (const [column] of FILL_IF_EMPTY) {
        const current = existing[column];
        const next = incoming[column];
        if ((current === null || current === '') && next !== null && next !== undefined) {
          updates[column] = next;
        }
      }

      if ((existing.companyPhone === null || existing.companyPhone === '') && incoming.companyPhone) {
        updates.companyPhone = incoming.companyPhone;
      }
      if ((existing.companyCity === null || existing.companyCity === '') && incoming.companyCity) {
        updates.companyCity = incoming.companyCity;
      }
      if ((existing.compantyState === null || existing.compantyState === '') && incoming.compantyState) {
        updates.compantyState = incoming.compantyState;
      }

      const { data, error } = await supabase
        .from('leads_data')
        .update(updates)
        .eq('id', existing.id)
        .select('*')
        .single();

      if (error) throw new AppError(error.message || 'Failed to update lead.', 500);
      return { kind: 'updated', row: toPipelineRow(data) };
    },
  };
}

module.exports = {
  createLeadsDataRepo,
  toLeadsDataPayload,
};
