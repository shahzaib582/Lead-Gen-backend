const { it } = require('node:test');
const assert = require('node:assert/strict');
const { fetchAllRows } = require('../src/utils/fetchAllRows');
const { parseLeadDataId } = require('../src/utils/leadDataId');

it('database scans fetch rows beyond PostgREST response limits', async () => {
  const rows = Array.from({ length: 1227 }, (_, id) => ({ id }));
  let pages = 0;
  const result = await fetchAllRows(() => ({
    async range(start, end) {
      pages++;
      return { data: rows.slice(start, end + 1) };
    },
  }));
  assert.equal(result.length, 1227);
  assert.equal(pages, 3);
  await assert.rejects(
    fetchAllRows(() => ({
      async range() {
        return { error: {} };
      },
    })),
    /Failed to load/
  );
});

it('bigint lead IDs are preserved without precision loss', () => {
  assert.equal(parseLeadDataId('9007199254740993'), '9007199254740993');
  assert.equal(parseLeadDataId('123'), 123);
});
