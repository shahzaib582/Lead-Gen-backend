const AppError = require('./AppError');
const logger = require('./logger');

function isLikelyMissingColumn(dbError) {
  const msg = `${dbError?.message || ''} ${dbError?.details || ''} ${dbError?.hint || ''}`;
  const code = dbError?.code || '';
  return (
    code === '42703' ||
    (/^PGRST/.test(code) && /column|schema cache/i.test(msg)) ||
    /Could not find the ['"]?\w+['"]? column/i.test(msg) ||
    /column .* does not exist/i.test(msg) ||
    /schema cache/i.test(msg)
  );
}

function isLikelyMissingCampaignColumns(dbError) {
  return isLikelyMissingColumn(dbError);
}

function isLikelyMissingCampaignLeadColumns(dbError) {
  const msg = `${dbError?.message || ''} ${dbError?.details || ''}`;
  return (
    isLikelyMissingColumn(dbError) ||
    /reply_received|gmail_thread|gmail_message|gmail_subject|gmail_rfc/i.test(msg)
  );
}

/**
 * Map Supabase/PostgREST errors to AppError. Logs context for ops.
 * @param {import('@supabase/supabase-js').PostgrestError | null} error
 * @param {{ logLabel: string, fallbackMessage: string, duplicateMessage?: string, schemaHint?: boolean }} opts
 */
function throwSupabaseError(error, opts) {
  const { logLabel, fallbackMessage, duplicateMessage, schemaHint = false } = opts;

  if (!error) return;

  logger.error(`[Supabase] ${logLabel}`, {
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
  });

  if (error.code === '23505' && duplicateMessage) {
    throw new AppError(duplicateMessage, 409);
  }

  if (
    error.code === '23514' &&
    /campaigns_lead_source_check/i.test(`${error.message} ${error.details}`)
  ) {
    throw new AppError(
      'Invalid lead_source for this database. Allowed values: new, old, both. If "old" fails, run sql/migrations/20260519_campaigns_lead_source_allow_old.sql in Supabase.',
      400,
      'INVALID_LEAD_SOURCE'
    );
  }

  if (schemaHint && isLikelyMissingCampaignColumns(error)) {
    throw new AppError(
      'Database is missing columns the API expects on `campaigns` (e.g. `lead_source`, `sender_display_name`, `mail_template_samples`, `mail_training_instruction`, `target_tone`). Align `campaigns` with `sql/schema.sql` in the Supabase SQL editor, then retry.',
      500,
      'CAMPAIGN_DB_SCHEMA'
    );
  }

  if (opts.campaignLeadSchemaHint && isLikelyMissingCampaignLeadColumns(error)) {
    throw new AppError(
      'Database is missing columns the API expects on `campaign_leads` (e.g. `reply_received`, `gmail_thread_id`). Run sql/migrations/20260519_campaign_leads_gmail_thread_reply.sql in Supabase, then retry.',
      500,
      'CAMPAIGN_LEAD_DB_SCHEMA'
    );
  }

  if (error.code === 'PGRST116') {
    throw new AppError('Campaign lead not found.', 404);
  }

  throw new AppError(fallbackMessage, 500, 'DB_ERROR');
}

module.exports = {
  isLikelyMissingCampaignColumns,
  isLikelyMissingCampaignLeadColumns,
  throwSupabaseError,
};
