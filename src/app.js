const express        = require('express');
const rateLimit      = require('express-rate-limit');
const authRoutes     = require('./routes/authRoutes');
const googleRoutes   = require('./routes/googleAuthRoutes');
const campaignRoutes      = require('./routes/campaignRoutes');
const campaignLeadsRoutes = require('./routes/campaignLeadsRoutes');
const emailRoutes         = require('./routes/emailRoutes');
const leadsDataRoutes     = require('./routes/leadsDataRoutes');
const errorHandler   = require('./middleware/errorHandler');

const app = express();

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
    message: { success: false, message: 'Too many requests. Slow down.' },
  })
);

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/auth',         authRoutes);
app.use('/auth/google',  googleRoutes);
app.use('/campaigns',            campaignRoutes);
app.use('/campaigns/:id/leads',  campaignLeadsRoutes);
app.use('/emails',               emailRoutes);
app.use('/leads',                leadsDataRoutes);

// Protected /me example
const { authenticate } = require('./middleware/authenticate');
app.get('/me', authenticate, (req, res) => {
  res.json({ success: true, data: { user: req.user } });
});

// 404
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found.' });
});

// Global error handler (must be last)
app.use(errorHandler);

module.exports = app;