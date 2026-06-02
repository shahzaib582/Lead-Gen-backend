const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const httpRequestLogger = require('./middleware/httpRequestLogger');
const { globalLimiter } = require('./config/rateLimits');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const apiRoutes = require('./routes/index');
const billingWebhookRoutes = require('./routes/billingWebhookRoutes');
const errorHandler = require('./middleware/errorHandler');
const responseTime = require('./middleware/responseTime');
const { errorResponse, successResponse } = require('./utils/response');
const { swaggerBearerAutofillResponseInterceptor } = require('./config/swaggerBearerAutofill');

const openApiYamlPath = path.join(__dirname, 'docs', 'openapi.yaml');
YAML.load(openApiYamlPath);

const app = express();

function corsOriginCallback(origin, callback) {
  const raw = process.env.CORS_ORIGIN || process.env.FRONTEND_URL;
  const allowList = (raw || 'http://localhost:8080')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const devAllowAny =
    process.env.NODE_ENV !== 'production' &&
    (process.env.CORS_DEV_ALLOW_ANY === '1' || process.env.CORS_DEV_ALLOW_ANY === 'true');

  // Non-browser or same-origin requests often omit Origin
  if (!origin) {
    return callback(null, true);
  }

  if (devAllowAny) {
    return callback(null, origin);
  }

  if (allowList.length === 0) {
    return callback(null, 'http://localhost:8080');
  }

  if (allowList.includes(origin)) {
    return callback(null, origin);
  }

  return callback(null, false);
}

const trustProxy = process.env.TRUST_PROXY;
if (trustProxy === '1' || trustProxy === 'true') {
  app.set('trust proxy', 1);
} else if (trustProxy && !Number.isNaN(Number(trustProxy))) {
  app.set('trust proxy', Number(trustProxy));
}

app.use(
  cors({
    origin: corsOriginCallback,
    credentials: true,
    exposedHeaders: ['X-Response-Time', 'Server-Timing'],
  })
);

// ─── Security & parsing ───────────────────────────────────────────────────────

app.use(responseTime);
app.use(httpRequestLogger);

// Stripe webhooks require raw body for signature verification
app.use(
  '/api/billing/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  billingWebhookRoutes
);

app.use(express.json({ limit: '10kb' }));
app.disable('x-powered-by');

// ─── OpenAPI + Swagger UI (before global rate limit: UI loads many assets + spec fetch) ─

app.get('/api/openapi.yaml', (req, res) => {
  res.type('application/yaml');
  res.send(fs.readFileSync(openApiYamlPath, 'utf8'));
});

const swaggerUiOptions = {
  customSiteTitle: 'Lead Gen API — Reference',
  customCss: [
    '.swagger-ui .topbar{display:none}',
    '.swagger-ui .information-container.wrapper{padding-top:1rem}',
  ].join(''),
  swaggerOptions: {
    url: '/api/openapi.yaml',
    persistAuthorization: true,
    displayRequestDuration: true,
    filter: true,
    tryItOutEnabled: true,
    docExpansion: 'list',
    defaultModelsExpandDepth: 2,
    defaultModelExpandDepth: 3,
    // Browser-only: after Try it out on login / verify-otp / refresh / Google token, set Bearer
    responseInterceptor: swaggerBearerAutofillResponseInterceptor,
  },
};

app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(null, swaggerUiOptions));

app.use(globalLimiter);

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
