const express = require('express');
const { authenticate } = require('../middleware/authenticate');
const validateRequest = require('../middleware/validateRequest');
const { campaignLimiter } = require('../config/rateLimits');
const notificationsController = require('../controllers/notificationsController');
const {
  listValidation,
  markReadValidation,
  pushRegisterValidation,
  pushUnregisterValidation,
} = require('../validation/notificationRoutesValidation');

const router = express.Router();

router.get('/events', notificationsController.streamNotificationEvents);

router.use(authenticate);
router.use(campaignLimiter);

router.post('/events/session', notificationsController.createEventsSession);
router.get('/push/status', notificationsController.pushStatus);
router.post(
  '/push/register',
  pushRegisterValidation,
  validateRequest,
  notificationsController.registerPush
);
router.delete(
  '/push/register',
  pushUnregisterValidation,
  validateRequest,
  notificationsController.unregisterPush
);
router.get('/', listValidation, validateRequest, notificationsController.list);
router.get('/unread-count', notificationsController.unreadCount);
router.patch('/:id/read', markReadValidation, validateRequest, notificationsController.markRead);
router.post('/read-all', notificationsController.markAllRead);

module.exports = router;
