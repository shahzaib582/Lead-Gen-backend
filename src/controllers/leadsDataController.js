const { validationResult } = require('express-validator');
const leadsDataService = require('../services/leadsDataService');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { successResponse, successResponsePaginated } = require('../utils/response');

function handleValidationErrors(req) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const messages = errors
      .array()
      .map((e) => e.msg)
      .join(', ');
    throw new AppError(messages, 422);
  }
}

// ─── GET /leads ───────────────────────────────────────────────────────────────
// List leads with optional filters, search, pagination and sorting.
//
// Query params:
//   search, emailStatus, country, state, city, industry,
//   seniority, department, company, outreachStatus, fitTag,
//   sortBy, sortOrder, page, limit

async function list(req, res, next) {
  try {
    handleValidationErrors(req);

    const {
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
      sortBy,
      sortOrder,
      page,
      limit,
    } = req.query;

    const result = await leadsDataService.getLeads({
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
      sortBy,
      sortOrder,
      page: parseInt(page || '1', 10),
      limit: Math.min(parseInt(limit || '20', 10), 100),
    });

    logger.info('Leads fetched', {
      userId: req.user.id,
      total: result.total,
      page: result.page,
    });

    return successResponsePaginated(res, 200, undefined, result.leads, {
      page: result.page,
      limit: result.limit,
      total: result.total ?? 0,
      totalPages: result.totalPages,
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /leads/:id ───────────────────────────────────────────────────────────
// Get a single lead by ID.

async function getOne(req, res, next) {
  try {
    handleValidationErrors(req);

    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) throw new AppError('Invalid lead ID.', 400);

    const lead = await leadsDataService.getLeadById(id);

    return successResponse(res, 200, undefined, { lead });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, getOne };
