/**
 * Parse lead_data_id / leads_data.id for Supabase filters.
 * Numeric strings → number (bigint/int columns); otherwise string (e.g. UUID).
 */
function parseLeadDataId(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);
  return s;
}

module.exports = { parseLeadDataId };
