const AppError = require('./AppError');
const PAGE_SIZE = 500;

// buildQuery must return a fresh query with a stable unique ordering on every call.
async function fetchAllRows(buildQuery) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await buildQuery().range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new AppError('Failed to load database rows.', 500);
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}
module.exports = { fetchAllRows };
