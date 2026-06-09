/**
 * Adds timing headers so clients and Swagger "Try it out" can see server-side duration.
 * - X-Response-Time: e.g. "12.4ms"
 * - Server-Timing: RFC 9210 (e.g. total;dur=12.4) — visible in DevTools Network panel
 *
 * Stamps on first `res.write` or `res.end` so headers are set before they are flushed
 * (Express often sends headers on the first `write`, not only on `end`).
 */
function responseTime(req, res, next) {
  const start = process.hrtime.bigint();
  let stamped = false;

  function stamp() {
    if (stamped || res.headersSent) return;
    stamped = true;
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const dur = ms.toFixed(1);
    res.setHeader('X-Response-Time', `${dur}ms`);
    res.setHeader('Server-Timing', `total;dur=${dur}`);
  }

  const origWrite = res.write.bind(res);
  const origEnd = res.end.bind(res);

  res.write = function responseTimeWrite(...args) {
    stamp();
    return origWrite(...args);
  };

  res.end = function responseTimeEnd(...args) {
    stamp();
    return origEnd(...args);
  };

  next();
}

module.exports = responseTime;
