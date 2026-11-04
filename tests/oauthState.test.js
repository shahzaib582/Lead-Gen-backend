const { it } = require('node:test');
const assert = require('node:assert/strict');
const loadService = require('./helpers/loadService.cjs');

it('Google OAuth state is browser bound, expires, and is consumed once', async () => {
  const store = new Map();
  let cookie;
  const service = loadService('src/services/googleOAuthStateService.js', {
    '../queues/connection': {
      async set(key, value, mode, ttl) {
        assert.equal(mode, 'EX');
        assert.equal(ttl, 600);
        store.set(key, value);
      },
      async eval(script, count, key, hash) {
        if (store.get(key) !== hash) return 0;
        store.delete(key);
        return 1;
      },
    },
  });
  const res = {
    cookie(name, value, options) {
      cookie = `${name}=${value}`;
      assert.equal(options.httpOnly, true);
      assert.equal(options.sameSite, 'lax');
    },
    clearCookie() {},
  };
  const state = await service.createOAuthState(res);
  await assert.rejects(
    service.consumeOAuthState(
      { query: { state }, headers: { cookie: `leadgen_google_oauth=${'a'.repeat(64)}` } },
      res
    ),
    /Invalid or expired/
  );
  const req = { query: { state }, headers: { cookie } };
  await service.consumeOAuthState(req, res);
  await assert.rejects(service.consumeOAuthState(req, res), /Invalid or expired/);
  const expired = await service.createOAuthState(res);
  store.clear();
  await assert.rejects(
    service.consumeOAuthState({ query: { state: expired }, headers: { cookie } }, res),
    /Invalid or expired/
  );
});

it('production OAuth state cookies support cross-site SPA callbacks over HTTPS', async () => {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const service = loadService('src/services/googleOAuthStateService.js', {
      '../queues/connection': { async set() {} },
    });
    let options;
    await service.createOAuthState({
      cookie(name, value, opts) {
        options = opts;
      },
    });
    assert.equal(options.secure, true);
    assert.equal(options.httpOnly, true);
    assert.equal(options.sameSite, 'none');
  } finally {
    if (original === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original;
  }
});
