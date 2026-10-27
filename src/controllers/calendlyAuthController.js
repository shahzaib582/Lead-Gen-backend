const calendlyAuthService = require('../services/calendlyAuthService');
const AppError = require('../utils/AppError');
const { getFrontendRedirectUrl } = require('../config/calendlyOAuth');
const { successResponse } = require('../utils/response');

function redirectToCalendlyConnect(req, res, next) {
  try {
    const { authUrl } = calendlyAuthService.buildConnectAuthUrl(req.user.id);
    if (req.query.format === 'json') {
      return successResponse(res, 200, undefined, { authUrl });
    }
    res.redirect(authUrl);
  } catch (err) {
    next(err);
  }
}

async function handleCalendlyCallback(req, res) {
  const { code, state, error: oauthError } = req.query;

  if (oauthError) {
    return res.redirect(
      getFrontendRedirectUrl({ calendly: 'error', message: String(oauthError).slice(0, 120) })
    );
  }

  if (!code || !state) {
    return res.redirect(
      getFrontendRedirectUrl({ calendly: 'error', message: 'missing_code_or_state' })
    );
  }

  try {
    await calendlyAuthService.completeOAuthConnect(String(code), String(state));
    return res.redirect(getFrontendRedirectUrl({ calendly: 'connected' }));
  } catch (err) {
    const message = err instanceof AppError ? err.message : 'connect_failed';
    return res.redirect(
      getFrontendRedirectUrl({ calendly: 'error', message: String(message).slice(0, 120) })
    );
  }
}

async function getCalendlyStatus(req, res, next) {
  try {
    const status = await calendlyAuthService.getCalendlyAccountStatus(req.user.id);
    return successResponse(res, 200, undefined, status);
  } catch (err) {
    next(err);
  }
}

async function disconnectCalendly(req, res, next) {
  try {
    const result = await calendlyAuthService.disconnectCalendly(req.user.id);
    return successResponse(res, 200, 'Calendly disconnected.', result);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  redirectToCalendlyConnect,
  handleCalendlyCallback,
  getCalendlyStatus,
  disconnectCalendly,
};
