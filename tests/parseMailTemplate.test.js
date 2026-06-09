const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseMailTemplate } = require('../src/utils/parseMailTemplate');

describe('parseMailTemplate', () => {
  it('parses Subject line and body', () => {
    const { subject, body } = parseMailTemplate('Subject: Hello there\n\nLine one\nLine two');
    assert.equal(subject, 'Hello there');
    assert.equal(body, 'Line one\nLine two');
  });

  it('defaults subject when missing', () => {
    const { subject, body } = parseMailTemplate('Body only');
    assert.equal(subject, 'Reaching out');
    assert.equal(body, 'Body only');
  });
});
