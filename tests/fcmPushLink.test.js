const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildNotificationDeepLink,
  fcmStringData,
} = require('../src/utils/fcmPushLink');

describe('fcmPushLink', () => {
  it('buildNotificationDeepLink uses campaign path when campaignId set', () => {
    process.env.FRONTEND_URL = 'https://app.example.com';
    const link = buildNotificationDeepLink({
      type: 'reply_received',
      campaignId: '11111111-1111-1111-1111-111111111111',
    });
    assert.equal(
      link,
      'https://app.example.com/campaigns/11111111-1111-1111-1111-111111111111'
    );
  });

  it('fcmStringData coerces values to strings', () => {
    const data = fcmStringData({
      type: 'reply_received',
      notificationId: 'abc',
      count: 3,
      meta: { x: 1 },
      empty: null,
    });
    assert.equal(data.type, 'reply_received');
    assert.equal(data.count, '3');
    assert.equal(data.meta, '{"x":1}');
    assert.equal(data.empty, '');
  });
});
