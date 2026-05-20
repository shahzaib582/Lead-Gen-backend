const express = require('express');
const authRoutes = require('./authRoutes');
const googleRoutes = require('./googleAuthRoutes');
const campaignRoutes = require('./campaignRoutes');
const dashboardRoutes = require('./dashboardRoutes');
const leadsDataRoutes = require('./leadsDataRoutes');
const userRoutes = require('./userRoutes');
const meetingsRoutes = require('./meetingsRoutes');

const router = express.Router();

// Mounted at app.use('/api', router) — paths below are relative to /api
router.use('/auth', authRoutes);
router.use('/auth/google', googleRoutes);
router.use('/campaigns', campaignRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/leads', leadsDataRoutes);
router.use('/user', userRoutes);
router.use('/meetings', meetingsRoutes);

module.exports = router;
