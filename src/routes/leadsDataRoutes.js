const express = require('express');
const { listValidation, idValidation } = require('../validation/leadsDataRoutesValidation');
const leadsDataController = require('../controllers/leadsDataController');
const { authenticate } = require('../middleware/authenticate');
const validateRequest = require('../middleware/validateRequest');
const { leadsLimiter } = require('../config/rateLimits');

const router = express.Router();

router.use(authenticate);
router.use(leadsLimiter);

router.get('/', listValidation, validateRequest, leadsDataController.list);
router.get('/:id', idValidation, validateRequest, leadsDataController.getOne);

module.exports = router;
