const rateLimit = require('express-rate-limit');
const { createRateLimitHandler } = require('../utils/response');

function createLimiter(max, message) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max,
    handler: createRateLimitHandler(message),
    standardHeaders: true,
    legacyHeaders: false,
  });
}

const globalLimiter = createLimiter(200, 'Too many requests. Slow down.');
const authLimiter = createLimiter(20, 'Too many requests. Please try again later.');
const loginLimiter = createLimiter(10, 'Too many login attempts. Please try again later.');
const refreshLimiter = createLimiter(30, 'Too many refresh requests.');
const googleLimiter = createLimiter(30, 'Too many Google auth requests. Please try again later.');
const campaignLimiter = createLimiter(100, 'Too many campaign requests. Please try again later.');
const leadsLimiter = createLimiter(200, 'Too many requests. Please try again later.');

module.exports = {
  globalLimiter,
  authLimiter,
  loginLimiter,
  refreshLimiter,
  googleLimiter,
  campaignLimiter,
  leadsLimiter,
};
