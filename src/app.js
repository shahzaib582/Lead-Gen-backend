const express = require('express');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const apiRoutes = require('./routes/index');
const errorHandler = require('./middleware/errorHandler');
const { errorResponse, successResponse, createRateLimitHandler } = require('./utils/response');

const app = express();

function corsOriginConfig() {
  const raw = process.env.CORS_ORIGIN || process.env.FRONTEND_URL;
  if (!raw) return 'http://localhost:8080';
  const origins = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (origins.length === 0) return 'http://localhost:8080';
  if (origins.length === 1) return origins[0];
  return origins;
}

const trustProxy = process.env.TRUST_PROXY;
if (trustProxy === '1' || trustProxy === 'true') {
  app.set('trust proxy', 1);
} else if (trustProxy && !Number.isNaN(Number(trustProxy))) {
  app.set('trust proxy', Number(trustProxy));
}

app.use(
  cors({
    origin: corsOriginConfig(),
    credentials: true,
  })
);

// ─── Security & parsing ───────────────────────────────────────────────────────

app.use(express.json({ limit: '10kb' }));
app.disable('x-powered-by');

// Global rate limit
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    handler: createRateLimitHandler('Too many requests. Slow down.'),
  })
);

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => successResponse(res, 200, undefined, { status: 'ok' }));

app.use('/api', apiRoutes);

// 404
app.use((req, res) => {
  return errorResponse(res, 404, 'Route not found.');
});

// Global error handler (must be last)
app.use(errorHandler);

module.exports = app;
