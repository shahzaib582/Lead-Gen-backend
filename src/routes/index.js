const express = require('express');
const authRoutes = require('./authRoutes');
const googleRoutes = require('./googleAuthRoutes');
const campaignRoutes = require('./campaignRoutes');
const campaignLeadsRoutes = require('./campaignLeadsRoutes');
const emailRoutes = require('./emailRoutes');
const leadsDataRoutes = require('./leadsDataRoutes');
const { authenticate } = require('../middleware/authenticate');
const { successResponse } = require('../utils/response');

const router = express.Router();

// Mounted at app.use('/api', router) — paths below are relative to /api
router.use('/auth', authRoutes);
router.use('/auth/google', googleRoutes);
router.use('/campaigns', campaignRoutes);
router.use('/campaigns/:id/leads', campaignLeadsRoutes);
router.use('/emails', emailRoutes);
router.use('/leads', leadsDataRoutes);

router.get('/me', authenticate, (req, res) => {
  return successResponse(res, 200, 'User fetched successfully.', { user: req.user });
});

module.exports = router;
