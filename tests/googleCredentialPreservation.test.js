const { it } = require('node:test');
const assert = require('node:assert/strict');
const loadService = require('./helpers/loadService.cjs');

it('identity-only login cannot overwrite Gmail credentials and renewal preserves refresh tokens', async () => {
  const writes = [];
  const service = loadService('src/services/googleAuthService.js', {
    '../config/supabase': {
      from() {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          async maybeSingle() {
            return { data: { google_id: 'google-user', google_refresh_token: 'saved-refresh' } };
          },
          async upsert(row) {
            writes.push(row);
            return {};
          },
        };
      },
    },
    './userService': {},
    '../config/googleOAuth': {},
    '../utils/logger': {},
  });
  const profile = { email: 'owner@example.com', googleId: 'google-user' };
  await service.upsertGoogleAccount('user', { ...profile, googleTokens: null });
  assert.equal(writes.length, 0);
  await service.upsertGoogleAccount('user', {
    ...profile,
    googleTokens: { access_token: 'new-access', scope: 'gmail.send' },
  });
  assert.equal(writes[0].google_refresh_token, 'saved-refresh');
  await service.upsertGoogleAccount('user', {
    ...profile,
    googleId: 'different-user',
    googleTokens: { access_token: 'other-access' },
  });
  assert.equal(writes[1].google_refresh_token, null);
});
