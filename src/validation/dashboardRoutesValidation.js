const { query } = require('express-validator');
const { PERIOD_PRESETS } = require('../utils/dashboardDateRange');

const periodQuery = query('period')
  .optional()
  .isIn([...PERIOD_PRESETS])
  .withMessage(`period must be one of: ${[...PERIOD_PRESETS].join(', ')}.`);

const customFromQuery = query('from')
  .optional()
  .isISO8601({ strict: true, strictSeparator: true })
  .withMessage('from must be a valid date (YYYY-MM-DD).');

const customToQuery = query('to')
  .optional()
  .isISO8601({ strict: true, strictSeparator: true })
  .withMessage('to must be a valid date (YYYY-MM-DD).');

const pageQuery = query('page')
  .optional()
  .isInt({ min: 1 })
  .withMessage('page must be a positive integer.')
  .toInt();

const limitQuery = query('limit')
  .optional()
  .isInt({ min: 1, max: 50 })
  .withMessage('limit must be between 1 and 50.')
  .toInt();

const summaryValidation = [];

const performanceValidation = [periodQuery, customFromQuery, customToQuery];

const activeCampaignsValidation = [pageQuery, limitQuery];

const recentActivityValidation = [pageQuery, limitQuery];

module.exports = {
  summaryValidation,
  performanceValidation,
  activeCampaignsValidation,
  recentActivityValidation,
};
