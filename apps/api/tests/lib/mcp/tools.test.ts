import { expect, test } from 'bun:test';
import { createNibrunMcpHandler } from '#lib/mcp/handler.ts';
import { called, toolCall } from '#tests/lib/mcp/support/call.ts';
import {
  anApp,
  HOSTNAME,
  SLUG,
  servicesHolding,
  UPDATED_AT,
} from '#tests/lib/mcp/support/services.ts';

// Every file under `tools/` has to be registered in `createNibrunMcpServer` to reach a client, and
// one that is written but never registered is not a type error anywhere.
test('every tool file reaches the client', async () => {
  const replied = await called({
    services: servicesHolding({ apps: [] }),
    body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
  });

  const tools = (replied.result as unknown as { tools: { name: string }[] }).tools;
  expect(tools.map((tool) => tool.name).toSorted()).toEqual([
    'add_domain',
    'delete_app',
    'deploy_app',
    'export_app',
    'get_app',
    'get_export',
    'list_apps',
    'list_files',
    'read_logs',
    'redeploy_app',
    'remove_domain',
    'resume_app',
    'suspend_app',
  ]);
});

test('a listing answers with the address each app is reached at', async () => {
  const replied = await called({
    services: servicesHolding({ apps: [anApp({ state: 'suspended' })] }),
    body: toolCall({ name: 'list_apps', args: {} }),
  });

  expect(replied.result?.structuredContent).toEqual({
    apps: [{ slug: SLUG, url: `https://${HOSTNAME}`, state: 'suspended', updatedAt: UPDATED_AT }],
  });
});

/**
 * The reason this is worth a test of its own: a refusal is the sentence `@repo/app-operations`
 * throws, and a model reading it can act on it. Raising it as a failed request instead would put
 * it somewhere the model never looks.
 */
test('an operation the app state refuses comes back as the sentence saying why', async () => {
  const replied = await called({
    services: servicesHolding({ apps: [anApp({ state: 'suspended' })] }),
    body: toolCall({ name: 'list_files', args: { app: SLUG } }),
  });

  expect(replied.result?.isError).toBe(true);
  expect(replied.result?.content[0]?.text).toBe(
    `App ${SLUG} is suspended, so nothing is mounting its filesystem to read. Resume it first.`,
  );
});

test('an app nobody has is refused by name rather than by an empty answer', async () => {
  const replied = await called({
    services: servicesHolding({ apps: [] }),
    body: toolCall({ name: 'get_app', args: { app: SLUG } }),
  });

  expect(replied.result?.isError).toBe(true);
  expect(replied.result?.content[0]?.text).toBe(`No app with slug ${SLUG}.`);
});

/**
 * The auth contract, which is the one thing about this code a reader has to know: the SDK treats
 * `authInfo` as strictly pass-through and verifies nothing, so a route that forgets to say who it
 * authenticated would otherwise serve every tool with no owner to scope on.
 */
test('a caller the route never named reaches no tool at all', async () => {
  const handler = createNibrunMcpHandler({
    services: servicesHolding({ apps: [anApp({ state: 'active' })] }),
  });

  const response = await handler.fetch(
    new Request('https://nibrun.test/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(toolCall({ name: 'list_apps', args: {} })),
    }),
  );

  expect(await response.text()).not.toContain('"structuredContent"');
});
