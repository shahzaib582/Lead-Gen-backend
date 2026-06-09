const express = require('express');
const billingWebhookController = require('../controllers/billingWebhookController');

const router = express.Router();

router.post('/', billingWebhookController.handleWebhook);

module.exports = router;
