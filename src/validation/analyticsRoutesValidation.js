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

const periodValidation = [periodQuery, customFromQuery, customToQuery];

const weeksQuery = query('weeks')
  .optional()
  .isInt({ min: 1, max: 12 })
  .withMessage('weeks must be between 1 and 12.')
  .toInt();

module.exports = {
  periodValidation,
  weeksQuery,
};
