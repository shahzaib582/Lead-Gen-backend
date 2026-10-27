const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getFrontendUrl, buildBillingReturnUrl } = require('../src/config/stripe');

describe('stripe billing URLs', () => {
  it('getFrontendUrl strips trailing slash', () => {
    const prev = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = 'https://rapidai2x.com/';
    try {
      assert.equal(getFrontendUrl(), 'https://rapidai2x.com');
    } finally {
      if (prev === undefined) delete process.env.FRONTEND_URL;
      else process.env.FRONTEND_URL = prev;
    }
  });

  it('buildBillingReturnUrl joins base and path safely', () => {
    const prev = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = 'https://rapidai2x.com';
    try {
      assert.equal(
        buildBillingReturnUrl('/settings/billing'),
        'https://rapidai2x.com/settings/billing'
      );
      assert.equal(buildBillingReturnUrl('//evil.com'), 'https://rapidai2x.com/billing');
    } finally {
      if (prev === undefined) delete process.env.FRONTEND_URL;
      else process.env.FRONTEND_URL = prev;
    }
  });
});
