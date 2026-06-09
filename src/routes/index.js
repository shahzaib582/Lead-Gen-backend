const express = require('express');
const authRoutes = require('./authRoutes');
const googleRoutes = require('./googleAuthRoutes');
const campaignRoutes = require('./campaignRoutes');
const dashboardRoutes = require('./dashboardRoutes');
const analyticsRoutes = require('./analyticsRoutes');
const leadsDataRoutes = require('./leadsDataRoutes');
const userRoutes = require('./userRoutes');
const meetingsRoutes = require('./meetingsRoutes');
const notificationRoutes = require('./notificationRoutes');
const billingRoutes = require('./billingRoutes');

const router = express.Router();

// Mounted at app.use('/api', router) — paths below are relative to /api
router.use('/auth', authRoutes);
router.use('/auth/google', googleRoutes);
router.use('/campaigns', campaignRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/leads', leadsDataRoutes);
router.use('/user', userRoutes);
router.use('/meetings', meetingsRoutes);
router.use('/notifications', notificationRoutes);
router.use('/billing', billingRoutes);

module.exports = router;
