const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const {
  assertMailTemplateSamplesValid,
  formatMailTemplateSamplesForPrompt,
} = require('../src/utils/mailTemplateSamples');

describe('mailTemplateSamples', () => {
  it('accepts undefined/null', () => {
    assertMailTemplateSamplesValid(undefined);
    assertMailTemplateSamplesValid(null);
  });

  it('accepts empty array', () => {
    assertMailTemplateSamplesValid([]);
  });

  it('rejects non-array', () => {
    assert.throws(() => assertMailTemplateSamplesValid({}), /must be an array/);
  });

  it('requires at least one content field per object', () => {
    assert.throws(() => assertMailTemplateSamplesValid([{}]), /at least one non-empty/);
  });

  it('formats samples for prompt', () => {
    const text = formatMailTemplateSamplesForPrompt([
      { subject: 'Hi', body: 'Hello {{firstName}}' },
      { html: '<p>X</p>' },
    ]);
    assert.ok(text.includes('Sample 1'));
    assert.ok(text.includes('Subject: Hi'));
    assert.ok(text.includes('Hello {{firstName}}'));
    assert.ok(text.includes('Sample 2'));
    assert.ok(text.includes('<p>X</p>'));
  });

  it('returns null for empty samples', () => {
    assert.equal(formatMailTemplateSamplesForPrompt([]), null);
    assert.equal(formatMailTemplateSamplesForPrompt(null), null);
  });
});
