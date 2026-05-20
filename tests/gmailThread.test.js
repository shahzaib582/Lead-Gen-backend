const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseEmailAddress,
  normalizeMessageId,
  buildReplySubject,
  isInboundFromLead,
} = require('../src/utils/gmailThread');

describe('gmailThread', () => {
  it('parseEmailAddress extracts angle-bracket address', () => {
    assert.equal(parseEmailAddress('Hamza <hamza@example.com>'), 'hamza@example.com');
  });

  it('normalizeMessageId wraps bare ids', () => {
    assert.equal(normalizeMessageId('abc@mail.gmail.com'), '<abc@mail.gmail.com>');
  });

  it('buildReplySubject prefixes Re:', () => {
    assert.equal(buildReplySubject('Hello'), 'Re: Hello');
    assert.equal(buildReplySubject('Re: Hello'), 'Re: Hello');
  });

  it('isInboundFromLead detects lead and excludes outbound id', () => {
    assert.equal(
      isInboundFromLead(
        'Lead <lead@test.com>',
        'lead@test.com',
        'me@gmail.com',
        'msg-out',
        'msg-out'
      ),
      false
    );
    assert.equal(
      isInboundFromLead('Lead <lead@test.com>', 'lead@test.com', 'me@gmail.com', 'msg-out', 'msg-in'),
      true
    );
    assert.equal(
      isInboundFromLead('Me <me@gmail.com>', 'lead@test.com', 'me@gmail.com', 'msg-out', 'msg-in'),
      false
    );
  });
});
