import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { HunterError, verifyHunterEmail } from './hunter.ts';

Deno.test('maps Hunter valid status to verified', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        data: { email: 'ada@example.com', status: 'valid', score: 98, sources: [] },
      }),
      {
        status: 200,
      }
    );
  try {
    const result = await verifyHunterEmail('ada@example.com', 'secret');
    assertEquals(result.status, 'verified');
    assertEquals(result.request_type, 'verification');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('maps Hunter risky statuses and upstream failures safely', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ data: { email: 'ada@example.com', status: 'accept_all' } }), {
        status: 200,
      });
    assertEquals((await verifyHunterEmail('ada@example.com', 'secret')).status, 'risky');
    globalThis.fetch = async () => new Response('', { status: 429 });
    await assertRejects(() => verifyHunterEmail('ada@example.com', 'secret'), HunterError);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
