const express = require('express');
const trackingController = require('../controllers/trackingController');

const router = express.Router();

router.get('/open/:token', trackingController.openPixel);

module.exports = router;
