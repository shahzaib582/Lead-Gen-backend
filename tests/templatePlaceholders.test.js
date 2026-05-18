const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { applyTemplatePlaceholders } = require('../src/utils/templatePlaceholders');

describe('applyTemplatePlaceholders', () => {
  it('replaces known placeholders', () => {
    const out = applyTemplatePlaceholders('Hi {{firstName}} ({{fullName}}) <{{email}}>', {
      firstName: 'Ada',
      fullName: 'Ada Lovelace',
      email: 'ada@example.com',
    });
    assert.equal(out, 'Hi Ada (Ada Lovelace) <ada@example.com>');
  });

  it('replaces missing values with empty string', () => {
    assert.equal(applyTemplatePlaceholders('Hi {{firstName}}', {}), 'Hi ');
  });
});
