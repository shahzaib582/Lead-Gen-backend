import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { ApolloError, searchApollo } from './apollo.ts';

const options = { page: 1, per_page: 25, search: {} };

const assertApolloKind = async (expectedKind: string) => {
  const error = (await assertRejects(
    () => searchApollo(options, 'secret'),
    ApolloError
  )) as ApolloError;
  assertEquals(error.kind, expectedKind);
};

Deno.test('parses a successful Apollo response', async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount++;
    return callCount === 1
      ? new Response(JSON.stringify({ total_entries: 1, people: [{ id: 'person-1' }] }), {
          status: 200,
        })
      : new Response(JSON.stringify({ matches: [{ id: 'person-1', last_name: 'Lovelace' }] }), {
          status: 200,
        });
  };
  try {
    assertEquals((await searchApollo(options, 'secret')).total_entries, 1);
    assertEquals(callCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('maps Apollo auth, rate limit, malformed, and network failures', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const [status, kind] of [
      [401, 'authentication'],
      [429, 'rate_limit'],
      [200, 'malformed'],
    ] as const) {
      globalThis.fetch = async () =>
        new Response(status === 200 ? '{}' : '', { status, headers: { 'retry-after': '10' } });
      await assertApolloKind(kind);
    }
    globalThis.fetch = async () => {
      throw new TypeError('offline');
    };
    await assertApolloKind('upstream');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
