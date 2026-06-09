const supabase = require('../config/supabase');
const AppError = require('../utils/AppError');

// All queryable/filterable columns from leads_data table
const ALLOWED_FILTERS = [
  'emailStatus',
  'country',
  'state',
  'city',
  'industry',
  'seniority',
  'department',
  'company',
  'outreachStatus',
  'fitTag',
];

const ALLOWED_SORT_COLUMNS = [
  'created_at',
  'fullName',
  'email',
  'company',
  'country',
  'fitScore',
  'dateAdded',
];

/**
 * List leads from leads_data with optional filters, search, pagination and sorting.
 *
 * @param {object} options
 * @param {string}  [options.search]        - Full-text search across fullName, email, company
 * @param {string}  [options.emailStatus]   - Filter by emailStatus column
 * @param {string}  [options.country]       - Filter by country
 * @param {string}  [options.state]         - Filter by state
 * @param {string}  [options.city]          - Filter by city
 * @param {string}  [options.industry]      - Filter by industry
 * @param {string}  [options.seniority]     - Filter by seniority
 * @param {string}  [options.department]    - Filter by department
 * @param {string}  [options.company]       - Filter by company
 * @param {string}  [options.outreachStatus]- Filter by outreachStatus
 * @param {string}  [options.fitTag]        - Filter by fitTag
 * @param {string}  [options.sortBy]        - Column to sort by (default: created_at)
 * @param {string}  [options.sortOrder]     - 'asc' or 'desc' (default: desc)
 * @param {number}  [options.page]          - Page number (default: 1)
 * @param {number}  [options.limit]         - Page size (default: 20, max: 100)
 */
async function getLeads({
  search,
  emailStatus,
  country,
  state,
  city,
  industry,
  seniority,
  department,
  company,
  outreachStatus,
  fitTag,
  sortBy = 'created_at',
  sortOrder = 'desc',
  page = 1,
  limit = 20,
} = {}) {
  // Validate sort column to prevent injection
  const safeSortBy = ALLOWED_SORT_COLUMNS.includes(sortBy) ? sortBy : 'created_at';
  const ascending = sortOrder === 'asc';

  let query = supabase
    .from('leads_data')
    .select('*', { count: 'exact' })
    .order(safeSortBy, { ascending })
    .range((page - 1) * limit, page * limit - 1);

  // Full-text search across name, email and company
  if (search && search.trim()) {
    const term = search.trim();
    query = query.or(`fullName.ilike.%${term}%,email.ilike.%${term}%,company.ilike.%${term}%`);
  }

  // Apply each optional exact-match filter
  if (emailStatus) query = query.eq('emailStatus', emailStatus);
  if (country) query = query.eq('country', country);
  if (state) query = query.eq('state', state);
  if (city) query = query.eq('city', city);
  if (industry) query = query.eq('industry', industry);
  if (seniority) query = query.eq('seniority', seniority);
  if (department) query = query.eq('department', department);
  if (company) query = query.ilike('company', `%${company}%`);
  if (outreachStatus) query = query.eq('outreachStatus', outreachStatus);
  if (fitTag) query = query.eq('fitTag', fitTag);

  const { data, error, count } = await query;

  if (error) {
    throw new AppError(`Failed to fetch leads: ${error.message}`, 500);
  }

  return {
    leads: data,
    total: count,
    page,
    limit,
    totalPages: Math.ceil(count / limit),
  };
}

/**
 * Get a single lead by its numeric ID.
 * @param {number} id
 */
async function getLeadById(id) {
  const { data, error } = await supabase.from('leads_data').select('*').eq('id', id).single();

  if (error || !data) throw new AppError('Lead not found.', 404);
  return data;
}

module.exports = { getLeads, getLeadById, ALLOWED_FILTERS, ALLOWED_SORT_COLUMNS };
