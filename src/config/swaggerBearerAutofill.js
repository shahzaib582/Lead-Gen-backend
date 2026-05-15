/**
 * Swagger UI `responseInterceptor` — runs in the browser (injected by swagger-ui-express).
 * After a successful token-issuing request from Try it out, pre-fills HTTP Bearer (`bearerAuth`).
 */
function swaggerBearerAutofillResponseInterceptor(res) {
  try {
    if (!res || res.status !== 200) {
      return res;
    }
    const url = String(res.url || (res.config && res.config.url) || '')
      .split('?')[0]
      .replace(/\/+$/, '');
    const isTokenEndpoint =
      /\/api\/auth\/(login|verify-otp|refresh|reset-password)$/.test(url) || /\/api\/auth\/google\/token$/.test(url);
    if (!isTokenEndpoint) {
      return res;
    }

    const raw =
      res.body != null ? res.body : res.text != null ? res.text : res.data != null ? res.data : null;
    if (raw == null) {
      return res;
    }
    const body = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const token = body && body.data && body.data.accessToken;
    const ui = typeof globalThis !== 'undefined' ? globalThis.ui : null;
    if (!token || !ui || !ui.authActions) {
      return res;
    }

    ui.authActions.authorize({
      bearerAuth: {
        name: 'bearerAuth',
        schema: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        value: token,
      },
    });
  } catch {
    // ignore parse errors
  }
  return res;
}

module.exports = { swaggerBearerAutofillResponseInterceptor };
