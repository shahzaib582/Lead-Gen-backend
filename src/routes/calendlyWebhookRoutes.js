const express = require('express');
const calendlyWebhookController = require('../controllers/calendlyWebhookController');

const router = express.Router({ mergeParams: true });

router.post('/', calendlyWebhookController.receiveWebhook);

module.exports = router;
