const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isValidCalendlyUrl,
  normalizeCalendlyUrl,
  buildCalendlyBookingLink,
} = require('../src/utils/calendlyUrl');

describe('calendlyUrl', () => {
  it('accepts standard Calendly HTTPS links', () => {
    assert.equal(isValidCalendlyUrl('https://calendly.com/acme/30min'), true);
    assert.equal(isValidCalendlyUrl('http://calendly.com/acme'), false);
    assert.equal(isValidCalendlyUrl('https://example.com/acme'), false);
  });

  it('normalizes trailing slashes', () => {
    assert.equal(
      normalizeCalendlyUrl('https://calendly.com/acme/30min/'),
      'https://calendly.com/acme/30min'
    );
  });

  it('appends UTM tracking for campaign leads', () => {
    const link = buildCalendlyBookingLink('https://calendly.com/acme/30min', {
      campaignId: 'camp-1',
      campaignLeadId: 'lead-1',
    });
    const parsed = new URL(link);
    assert.equal(parsed.searchParams.get('utm_source'), 'leadgen');
    assert.equal(parsed.searchParams.get('utm_medium'), 'email');
    assert.equal(parsed.searchParams.get('utm_campaign'), 'camp-1');
    assert.equal(parsed.searchParams.get('utm_content'), 'lead-1');
  });
});
