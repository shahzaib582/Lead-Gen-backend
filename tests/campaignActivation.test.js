const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { needsTemplateJob } = require('../src/services/campaignActivationRules');

describe('campaignActivationRules.needsTemplateJob', () => {
  it('returns false when status is not pending', () => {
    assert.equal(
      needsTemplateJob({ id: '1', status: 'template_generated', mail_template: '' }),
      false
    );
  });

  it('returns true when pending and mail_template null', () => {
    assert.equal(needsTemplateJob({ id: '1', status: 'pending', mail_template: null }), true);
  });

  it('returns true when pending and mail_template is whitespace', () => {
    assert.equal(needsTemplateJob({ id: '1', status: 'pending', mail_template: '  \n  ' }), true);
  });

  it('returns false when pending and template has content', () => {
    assert.equal(
      needsTemplateJob({ id: '1', status: 'pending', mail_template: 'subject: Hi\n\nBody' }),
      false
    );
  });
});
