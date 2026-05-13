/**
 * Standard JSON helpers for Express handlers.
 * Matches existing API shape: { success: boolean, message?, data?, ... }.
 */

/**
 * @param {import('express').Response} res
 * @param {number} statusCode
 * @param {string} message
 * @param {Record<string, unknown>} [extras]  merged into payload (e.g. `{ errors: [...] }`)
 */
function errorResponse(res, statusCode, message, extras = {}) {
  return res.status(statusCode).json({
    success: false,
    message,
    ...extras,
  });
}

/**
 * Factory for express-rate-limit `handler` so limit responses use {@link errorResponse}.
 * @param {string} message
 */
function createRateLimitHandler(message) {
  return (_req, res, _next, options) => {
    const status = options && typeof options.statusCode === 'number' ? options.statusCode : 429;
    return errorResponse(res, status, message);
  };
}

/**
 * @param {import('express').Response} res
 * @param {number} statusCode
 * @param {string} [message]  omitted when undefined / null / ''
 * @param {unknown} [data]    becomes `data` key; omit when undefined
 */
function successResponse(res, statusCode, message, data) {
  const payload = { success: true };
  if (message !== undefined && message !== null && message !== '') {
    payload.message = message;
  }
  if (data !== undefined) {
    payload.data = data;
  }
  return res.status(statusCode).json(payload);
}

/**
 * Paginated list: items in `data`, counts in `pagination`.
 *
 * @param {import('express').Response} res
 * @param {number} statusCode
 * @param {string} [message]
 * @param {unknown[]} items
 * @param {{ page: number; limit: number; total: number; totalPages?: number }} meta
 */
function successResponsePaginated(res, statusCode, message, items, meta) {
  const { page, limit, total } = meta;
  const totalPages =
    meta.totalPages !== undefined
      ? meta.totalPages
      : Math.ceil(total / limit) || (total > 0 ? 1 : 0);

  const payload = {
    success: true,
    data: items,
    pagination: {
      page,
      limit,
      total,
      totalPages,
    },
  };
  if (message !== undefined && message !== null && message !== '') {
    payload.message = message;
  }
  return res.status(statusCode).json(payload);
}

module.exports = {
  errorResponse,
  createRateLimitHandler,
  successResponse,
  successResponsePaginated,
};
