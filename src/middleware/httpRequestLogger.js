const logger = require('../utils/logger');

const SKIP_PATHS = new Set(['/health', '/favicon.ico']);

function shouldSkip(path) {
  if (SKIP_PATHS.has(path)) return true;
  if (path.startsWith('/api/docs')) return true;
  return false;
}

function statusLabel(status) {
  if (status >= 500) return 'ERROR';
  if (status >= 400) return 'FAIL';
  if (status === 304) return 'CACHE';
  return 'OK';
}

/**
 * Readable one-line HTTP logs for Render/production (replaces morgan "combined").
 */
function httpRequestLogger(req, res, next) {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const path = req.originalUrl || req.url;
    const pathname = path.split('?')[0];
    if (shouldSkip(pathname)) return;

    if (process.env.LOG_HTTP_SKIP_304 === '1' && res.statusCode === 304) {
      return;
    }

    const ms = (Number(process.hrtime.bigint() - start) / 1e6).toFixed(0);
    const status = res.statusCode;
    const label = statusLabel(status);
    const query = path.includes('?') ? path.slice(path.indexOf('?')) : '';
    const line = `HTTP ${label} ${req.method} ${pathname}${query} → ${status} (${ms}ms)`;

    if (status >= 500) {
      logger.error(line);
    } else if (status >= 400) {
      logger.warn(line);
    } else {
      logger.info(line);
    }
  });

  next();
}

module.exports = httpRequestLogger;
