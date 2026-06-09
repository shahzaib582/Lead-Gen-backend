const express = require('express');
const { authenticate } = require('../middleware/authenticate');
const validateRequest = require('../middleware/validateRequest');
const { campaignLimiter } = require('../config/rateLimits');
const billingController = require('../controllers/billingController');
const {
  checkoutValidation,
  changePlanValidation,
  defaultPaymentMethodValidation,
  paymentMethodIdParam,
} = require('../validation/billingRoutesValidation');

const router = express.Router();

router.get('/plans', billingController.listPlans);

router.use(authenticate);
router.use(campaignLimiter);

router.get('/subscription', billingController.getSubscription);
router.get('/quota', billingController.getQuota);
router.post('/checkout', checkoutValidation, validateRequest, billingController.checkout);
router.post('/portal', billingController.portal);
router.post('/upgrade', changePlanValidation, validateRequest, billingController.upgrade);
router.post('/downgrade', changePlanValidation, validateRequest, billingController.downgrade);
router.post('/cancel', billingController.cancel);
router.post('/reactivate', billingController.reactivate);
router.get('/payment-methods', billingController.listPaymentMethods);
router.post(
  '/payment-methods/default',
  defaultPaymentMethodValidation,
  validateRequest,
  billingController.setDefaultPaymentMethod
);
router.delete(
  '/payment-methods/:paymentMethodId',
  paymentMethodIdParam,
  validateRequest,
  billingController.removePaymentMethod
);

module.exports = router;
