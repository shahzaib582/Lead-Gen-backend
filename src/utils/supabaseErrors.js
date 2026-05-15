const AppError = require('./AppError');
const logger = require('./logger');

function isLikelyMissingCampaignColumns(dbError) {
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

  if (schemaHint && isLikelyMissingCampaignColumns(error)) {
    throw new AppError(
      'Database is missing columns the API expects on `campaigns` (e.g. `lead_source`, `sender_display_name`). Align `campaigns` with `sql/schema.sql` in the Supabase SQL editor, then retry.',
      500,
      'CAMPAIGN_DB_SCHEMA'
    );
  }

  throw new AppError(fallbackMessage, 500, 'DB_ERROR');
}

module.exports = {
  isLikelyMissingCampaignColumns,
  throwSupabaseError,
};
