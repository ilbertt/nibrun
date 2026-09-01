import { beforeEach, expect, test } from 'bun:test';
import { apiHolding, deploymentsHolding, listedApp } from '#tests/support/api.ts';
import { recordingPrompts } from '#tests/support/prompts.ts';

const prompts = await recordingPrompts();

const { completeOptions } = await import('#lib/plan.ts');

beforeEach(() => {
  prompts.reset();
});

// A slug typed rather than chosen is read against the listing and the release the app is on,
// which together are what say whether a deploy can land.
function apiListing({
  apps,
  release = 'running',
}: {
  apps: Array<{ slug: string; state: string }>;
  release?: string;
}) {
  return apiHolding({
    apps: apps.map((app) => listedApp(app)),
    underApp: () => ({
      deployments: deploymentsHolding([{ id: 'deployment-1', state: release }]),
    }),
  });
}

test('an owner with no apps is asked what to call one, not which to use', async () => {
  const resolved = await completeOptions({
    api: apiListing({ apps: [] }),
    options: {},
    binarySource: '/tmp/my-server',
    args: ['serve'],
  });

  expect(resolved).toEqual({ name: 'my-server', port: 3000 });
  expect(prompts.transcript()).toEqual([
    'text:Name the app (my-server)',
    'text:Which HTTP port does the binary listen on? (3000)',
    'confirm:Create my-server and deploy?',
  ]);
});

test('a url suggests the same name the path to the same binary would', async () => {
  const resolved = await completeOptions({
    api: apiListing({ apps: [] }),
    options: {},
    binarySource: 'https://releases.test/v1/my-server',
    args: [],
  });

  expect(resolved).toEqual({ name: 'my-server', port: 3000 });
});

test('an app the owner cannot deploy onto is not offered', async () => {
  prompts.answers.chosen = 'demo-abc123';

  const resolved = await completeOptions({
    api: apiListing({
      apps: [
        { slug: 'demo-abc123', state: 'active' },
        { slug: 'gone-xyz789', state: 'deleted' },
      ],
    }),
    options: {},
    binarySource: '/tmp/my-server',
    args: [],
  });

  expect(resolved).toEqual({ app: 'demo-abc123' });
  expect(prompts.transcript()).toEqual([
    'select:Deploy onto which app? [A new app|demo-abc123]',
    'confirm:Deploy onto demo-abc123? This replaces what it is running.',
  ]);
});

test('a flag already given is not asked about again', async () => {
  const resolved = await completeOptions({
    api: apiListing({ apps: [] }),
    options: { name: 'my-app', port: 8080 },
    binarySource: '/tmp/my-server',
    args: ['serve', '--verbose'],
  });

  expect(resolved).toEqual({ name: 'my-app', port: 8080 });
  expect(prompts.transcript()).toEqual(['confirm:Create my-app and deploy?']);
});

test('what the binary will be run with is shown before anything is uploaded', async () => {
  await completeOptions({
    api: apiListing({ apps: [{ slug: 'demo-abc123', state: 'active' }] }),
    options: { app: 'demo-abc123' },
    binarySource: '/tmp/my-server',
    args: ['serve', '--verbose'],
  });

  expect(prompts.notes.at(-1)).toContain('args: serve --verbose');
  expect(prompts.notes.at(-1)).toContain('binary: /tmp/my-server');
});

// Both halves of the summary are wrong for a suspended app: nothing is running for the deploy to
// replace, and nothing would start what it landed.
test('a named app that cannot be deployed onto is refused before anything is asked', async () => {
  const attempt = completeOptions({
    api: apiListing({ apps: [{ slug: 'demo-abc123', state: 'suspended' }], release: 'stopped' }),
    options: { app: 'demo-abc123' },
    binarySource: '/tmp/my-server',
    args: [],
  });

  await expect(attempt).rejects.toThrow(
    'App demo-abc123 is suspended, so a new release would never start. Resume it first.',
  );
  expect(prompts.asked).toEqual([]);
  expect(prompts.notes).toEqual([]);
});

test('declining the confirmation cancels rather than deploying', async () => {
  prompts.answers.confirmed = false;

  const attempt = completeOptions({
    api: apiListing({ apps: [] }),
    options: {},
    binarySource: '/tmp/my-server',
    args: [],
  });

  await expect(attempt).rejects.toThrow('Cancelled.');
});
