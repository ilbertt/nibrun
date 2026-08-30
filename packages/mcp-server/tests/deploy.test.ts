import { expect, test } from 'bun:test';
import { apiHolding } from '#tests/support/api.ts';
import { called, ORIGIN, toolCall } from '#tests/support/call.ts';

type Answered = {
  result?: {
    content?: { text: string }[];
    structuredContent?: { deployUrl?: string; detail?: string };
    inputRequests?: Record<string, { params?: { mode?: string; url?: string } }>;
  };
};

async function deploy(args: Record<string, unknown>): Promise<Answered> {
  return (await called({
    api: apiHolding({ apps: [] }),
    body: toolCall({ name: 'deploy_app', args }),
  })) as Answered;
}

/**
 * The whole point of the link: a model writes tool arguments and this server runs beside the api,
 * so the one thing neither of them has is the file. Everything they did work out goes with it.
 */
test('a deploy with no url hands back the deploy screen, already filled in', async () => {
  const answered = await deploy({
    name: 'pocketbase',
    port: 8090,
    args: ['serve'],
    environment: { TOKEN: 'abc' },
  });

  const link = answered.result?.structuredContent?.deployUrl ?? '';
  const search = new URL(link).searchParams;

  expect(link.startsWith(`${ORIGIN}/deploy`)).toBe(true);
  expect(search.get('name')).toBe('pocketbase');
  // A number, not a quoted one: the screen parses its search with `JSON.parse`.
  expect(search.get('port')).toBe('8090');
  expect(search.get('arg')).toBe('["serve"]');
  expect(search.get('env')).toBe('["TOKEN=abc"]');
});

// A variable removed means nothing on a form that has never set one, and the screen makes a new
// app rather than releasing onto a named one — so neither reaches the link.
test('a link carries only what a new app can be created with', async () => {
  const answered = await deploy({ name: 'app', app: 'existing', environment: { GONE: null } });
  const search = new URL(answered.result?.structuredContent?.deployUrl ?? '').searchParams;

  expect(search.get('env')).toBeNull();
  expect(search.get('app')).toBeNull();
});

/**
 * These tests reach the endpoint over the stateless 2025 path, which has no shape for a request
 * that pauses for the caller — so on that era the link is the answer rather than an elicitation.
 */
test('an era that cannot be asked is given the link as the answer itself', async () => {
  const answered = await deploy({ name: 'app' });

  expect(answered.result?.inputRequests).toBeUndefined();
  expect(answered.result?.content?.[0]?.text).toContain(`${ORIGIN}/deploy`);
  expect(answered.result?.structuredContent?.detail).toContain('pick the binary');
});
