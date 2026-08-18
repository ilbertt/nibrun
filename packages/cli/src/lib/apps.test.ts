import { beforeEach, expect, mock, test } from 'bun:test';
import type { Print } from '@parshjs/core';
import type { PublicApiClient } from '@repo/api-client/public';

type Asked = {
  message: string;
  options: Array<{ value: string; label: string; hint?: string | undefined }>;
};

const asked: Asked[] = [];
let chosen: unknown = null;

const clack = await import('@clack/prompts');

// Replaced wholesale rather than reached through a port, as `plan.test.ts` does it: what is being
// pinned down is which question an owner is asked and what it offers them. `mock.module` is global
// and outlives this file, so the rest of clack is spread back in: a stub carrying only what
// `#lib/apps.ts` asks for leaves whichever file runs next unable to import the rest.
mock.module('@clack/prompts', () => ({
  ...clack,
  isCancel: (value: unknown) => typeof value === 'symbol',
  select(opts: Asked) {
    asked.push(opts);
    return Promise.resolve(chosen);
  },
}));

const { announcedDeployment, selectApp } = await import('#lib/apps.ts');

let listings = 0;

function apiListing(apps: Array<{ slug: string; state: string }>): PublicApiClient {
  return {
    api: {
      apps: {
        get: () => {
          listings += 1;
          return Promise.resolve({ data: { apps }, error: null });
        },
      },
    },
  } as unknown as PublicApiClient;
}

beforeEach(() => {
  asked.length = 0;
  listings = 0;
  chosen = null;
});

test('a flag naming an app is the answer, and costs no listing to be one', async () => {
  const slug = await selectApp({
    api: apiListing([{ slug: 'quiet-otter', state: 'active' }]),
    slug: 'loud-badger',
    interactive: true,
  });

  expect(slug).toBe('loud-badger');
  expect(listings).toBe(0);
  expect(asked).toEqual([]);
});

test('an owner at a terminal is asked which app rather than told to name one', async () => {
  chosen = 'quiet-otter';

  const slug = await selectApp({
    api: apiListing([
      { slug: 'quiet-otter', state: 'active' },
      { slug: 'loud-badger', state: 'suspended' },
    ]),
    slug: undefined,
    interactive: true,
  });

  expect(slug).toBe('quiet-otter');
  expect(asked[0]?.message).toBe('Which app?');
  expect(asked[0]?.options).toEqual([
    { value: 'quiet-otter', label: 'quiet-otter', hint: undefined },
    { value: 'loud-badger', label: 'loud-badger', hint: 'suspended' },
  ]);
});

test('a pipe has nobody to ask, so it is told which flag names one', async () => {
  const attempt = selectApp({
    api: apiListing([{ slug: 'quiet-otter', state: 'active' }]),
    slug: undefined,
    interactive: false,
  });

  await expect(attempt).rejects.toThrow('Which app? Name one with --app.');
  expect(listings).toBe(0);
});

test('an owner with no apps is told what makes one, not shown an empty list', async () => {
  const attempt = selectApp({ api: apiListing([]), slug: undefined, interactive: true });

  await expect(attempt).rejects.toThrow('You have no apps.');
  expect(asked).toEqual([]);
});

test('walking away from the question is not answering it', async () => {
  chosen = Symbol('cancel');

  const attempt = selectApp({
    api: apiListing([{ slug: 'quiet-otter', state: 'active' }]),
    slug: undefined,
    interactive: true,
  });

  await expect(attempt).rejects.toThrow('Cancelled.');
});

test('which deployment a command settled on is said before it is read from', async () => {
  const dimmed: string[] = [];
  const api = {
    api: {
      apps: Object.assign(
        () => ({
          deployments: {
            get: () =>
              Promise.resolve({ data: { deployments: [{ id: 'deployment-2' }] }, error: null }),
          },
        }),
        {
          get: () =>
            Promise.resolve({
              data: { apps: [{ id: 'app-1', slug: 'quiet-otter' }] },
              error: null,
            }),
        },
      ),
    },
  } as unknown as PublicApiClient;

  const addressed = await announcedDeployment({
    api,
    slug: 'quiet-otter',
    deploymentId: undefined,
    print: { dim: (line: string) => dimmed.push(line) } as unknown as Print,
  });

  expect(addressed).toEqual({ appId: 'app-1', deploymentId: 'deployment-2', slug: 'quiet-otter' });
  expect(dimmed).toEqual(['quiet-otter · deployment deployment-2']);
});
