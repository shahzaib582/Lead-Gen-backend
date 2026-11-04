/* global __dirname */
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

module.exports = function loadService(relativePath, stubs) {
  const filename = path.resolve(__dirname, '../..', relativePath);
  const realRequire = createRequire(filename);
  const module = { exports: {} };
  const requireStub = (name) => (Object.hasOwn(stubs, name) ? stubs[name] : realRequire(name));
  new Function('require', 'module', 'exports', fs.readFileSync(filename, 'utf8'))(
    requireStub,
    module,
    module.exports
  );
  return module.exports;
};
