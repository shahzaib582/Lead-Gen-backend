const { body, param } = require('express-validator');

const PAID_PLAN_IDS = ['growth', 'pro'];
const ALL_PLAN_IDS = ['starter', 'growth', 'pro'];

const planIdBody = body('planId')
  .isIn(PAID_PLAN_IDS)
  .withMessage(`planId must be one of: ${PAID_PLAN_IDS.join(', ')}.`);

const anyPlanIdBody = body('planId')
  .isIn(ALL_PLAN_IDS)
  .withMessage(`planId must be one of: ${ALL_PLAN_IDS.join(', ')}.`);

const checkoutValidation = [planIdBody];

const changePlanValidation = [anyPlanIdBody];

const defaultPaymentMethodValidation = [
  body('paymentMethodId')
    .isString()
    .notEmpty()
    .withMessage('paymentMethodId is required.')
    .matches(/^pm_/)
    .withMessage('paymentMethodId must be a Stripe payment method id.'),
];

const paymentMethodIdParam = [
  param('paymentMethodId')
    .isString()
    .matches(/^pm_/)
    .withMessage('Invalid payment method id.'),
];

module.exports = {
  checkoutValidation,
  changePlanValidation,
  defaultPaymentMethodValidation,
  paymentMethodIdParam,
};
