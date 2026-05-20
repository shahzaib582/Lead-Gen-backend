const express = require('express');
const authRoutes = require('./authRoutes');
const googleRoutes = require('./googleAuthRoutes');
const campaignRoutes = require('./campaignRoutes');
const dashboardRoutes = require('./dashboardRoutes');
const leadsDataRoutes = require('./leadsDataRoutes');
const { authenticate } = require('../middleware/authenticate');
const { successResponse } = require('../utils/response');

const router = express.Router();

// Mounted at app.use('/api', router) — paths below are relative to /api
router.use('/auth', authRoutes);
router.use('/auth/google', googleRoutes);
router.use('/campaigns', campaignRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/leads', leadsDataRoutes);

router.get('/me', authenticate, (req, res) => {
  return successResponse(res, 200, 'User fetched successfully.', { user: req.user });
});

module.exports = router;
