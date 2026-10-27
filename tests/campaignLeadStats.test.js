const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { PAGE_SIZE } = require('../src/utils/campaignLeadStats');

describe('campaignLeadStats', () => {
  it('uses 1000-row pages to match PostgREST default limit', () => {
    assert.equal(PAGE_SIZE, 1000);
  });
});
