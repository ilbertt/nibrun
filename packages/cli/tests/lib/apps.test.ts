import { beforeEach, expect, test } from 'bun:test';
import type { Print } from '@parshjs/core';
import { apiHolding, deploymentsHolding, listedApp } from '#tests/support/api.ts';
import { APP_ID, SLUG } from '#tests/support/app.ts';
import { recordingPrompts } from '#tests/support/prompts.ts';

const prompts = await recordingPrompts();

const { announcedDeployment, selectApp, stillWriting } = await import('#lib/apps.ts');

let listings = 0;

function apiListing(apps: Array<{ slug: string; state: string }>) {
  return apiHolding({
    apps: () => {
      listings += 1;
      return apps.map((app) => listedApp(app));
    },
  });
}

beforeEach(() => {
  prompts.reset();
  listings = 0;
});

test('a flag naming an app is the answer, and costs no listing to be one', async () => {
  const slug = await selectApp({
    api: apiListing([{ slug: SLUG, state: 'active' }]),
    slug: 'loud-badger',
    interactive: true,
  });

  expect(slug).toBe('loud-badger');
  expect(listings).toBe(0);
  expect(prompts.asked).toEqual([]);
});

test('an owner at a terminal is asked which app rather than told to name one', async () => {
  prompts.answers.chosen = SLUG;

  const slug = await selectApp({
    api: apiListing([
      { slug: SLUG, state: 'active' },
      { slug: 'loud-badger', state: 'suspended' },
    ]),
    slug: undefined,
    interactive: true,
  });

  expect(slug).toBe(SLUG);
  expect(prompts.asked[0]?.message).toBe('Which app?');
  expect(prompts.asked[0]).toMatchObject({
    options: [
      { value: SLUG, label: SLUG, hint: undefined },
      { value: 'loud-badger', label: 'loud-badger', hint: 'suspended' },
    ],
  });
});

test('a pipe has nobody to ask, so it is told which flag names one', async () => {
  const attempt = selectApp({
    api: apiListing([{ slug: SLUG, state: 'active' }]),
    slug: undefined,
    interactive: false,
  });

  await expect(attempt).rejects.toThrow('Which app? Name one with --app.');
  expect(listings).toBe(0);
});

test('an owner with no apps is told what makes one, not shown an empty list', async () => {
  const attempt = selectApp({ api: apiListing([]), slug: undefined, interactive: true });

  await expect(attempt).rejects.toThrow('You have no apps.');
  expect(prompts.asked).toEqual([]);
});

test('walking away from the question is not answering it', async () => {
  prompts.answers.chosen = Symbol('cancel');

  const attempt = selectApp({
    api: apiListing([{ slug: SLUG, state: 'active' }]),
    slug: undefined,
    interactive: true,
  });

  await expect(attempt).rejects.toThrow('Cancelled.');
});

/** An app and what it is on, which together are what a command is allowed to act on. */
function apiRunning({
  state = 'active',
  deployments = [{ id: 'deployment-2', state: 'running' }],
}: {
  state?: string;
  deployments?: Array<{ id: string; state: string }>;
} = {}) {
  return apiHolding({
    apps: [listedApp({ state })],
    underApp: () => ({ deployments: deploymentsHolding(deployments) }),
  });
}

function printingDim(dimmed: string[]): Print {
  return { dim: (line: string) => dimmed.push(line) } as unknown as Print;
}

test('which deployment a command settled on is said before it is read from', async () => {
  const dimmed: string[] = [];

  const addressed = await announcedDeployment({
    api: apiRunning(),
    slug: SLUG,
    deploymentId: undefined,
    operation: 'logs',
    print: printingDim(dimmed),
  });

  expect(addressed).toMatchObject({
    appId: APP_ID,
    deploymentId: 'deployment-2',
    slug: SLUG,
  });
  expect(dimmed).toEqual([`${SLUG} · deployment deployment-2`]);
});

// The wait is the whole command, so what the app's state says about it is said before the first
// line rather than after however many the store held.
test('an app with nothing to read is refused before the stream is opened', async () => {
  const dimmed: string[] = [];

  const attempt = announcedDeployment({
    api: apiRunning({ deployments: [] }),
    slug: SLUG,
    deploymentId: undefined,
    operation: 'logs',
    print: printingDim(dimmed),
  });

  await expect(attempt).rejects.toThrow(
    `App ${SLUG} has never been deployed, so there is no output to read.`,
  );
  expect(dimmed).toEqual([]);
});

test('an app that is running is one whose output is worth waiting on', async () => {
  const addressed = await announcedDeployment({
    api: apiRunning(),
    slug: SLUG,
    deploymentId: undefined,
    operation: 'logs',
    print: printingDim([]),
  });

  expect(stillWriting(addressed)).toBe(true);
});

test('a suspended one is not, however much it wrote before it stopped', async () => {
  const addressed = await announcedDeployment({
    api: apiRunning({
      state: 'suspended',
      deployments: [{ id: 'deployment-2', state: 'stopped' }],
    }),
    slug: SLUG,
    deploymentId: undefined,
    operation: 'logs',
    print: printingDim([]),
  });

  expect(stillWriting(addressed)).toBe(false);
});

// Which release is being read is a different question from whether the app is running: a stream
// on the one it has moved off waits for a microVM that is not coming back.
test('nor is a release the app has moved off, whatever the app is doing', async () => {
  const addressed = await announcedDeployment({
    api: apiRunning(),
    slug: SLUG,
    deploymentId: 'deployment-1',
    operation: 'logs',
    print: printingDim([]),
  });

  expect(stillWriting(addressed)).toBe(false);
});
