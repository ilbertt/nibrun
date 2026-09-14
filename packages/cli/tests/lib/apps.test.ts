import { beforeEach, expect, test } from 'bun:test';
import type { Print } from '@parshjs/core';
import { apiHolding, deploymentsHolding, listedApp } from '#tests/support/api.ts';
import { APP_ID, NAME, SLUG } from '#tests/support/app.ts';
import { recordingPrompts } from '#tests/support/prompts.ts';

const prompts = await recordingPrompts();

const { announcedDeployment, selectApp, stillWriting } = await import('#lib/apps.ts');

let listings = 0;

function apiListing(apps: Array<{ id?: string; name: string; slug?: string; state: string }>) {
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

const OTTER = { id: APP_ID, name: NAME, slug: SLUG, state: 'active' };
const BADGER = { id: 'app-2', name: 'Loud Badger', slug: 'loud-badger-k1wegy', state: 'suspended' };
const OTHER_OTTER = { id: 'app-3', name: NAME, slug: 'quiet-otter-x7k2pq', state: 'active' };

test('a flag naming one app is that app, read off one listing', async () => {
  const app = await selectApp({
    api: apiListing([OTTER, BADGER]),
    name: 'Loud Badger',
    interactive: true,
  });

  expect(app).toEqual({ id: 'app-2', name: 'Loud Badger' });
  expect(listings).toBe(1);
  expect(prompts.asked).toEqual([]);
});

test('a flag naming two apps asks which, telling them apart by slug', async () => {
  prompts.answers.chosen = 'app-3';

  const app = await selectApp({
    api: apiListing([OTTER, OTHER_OTTER]),
    name: NAME,
    interactive: true,
  });

  expect(app).toEqual({ id: 'app-3', name: NAME });
  expect(prompts.asked[0]?.message).toBe(`Which ${NAME}?`);
  expect(prompts.asked[0]).toMatchObject({
    options: [
      { value: APP_ID, label: NAME, hint: SLUG },
      { value: 'app-3', label: NAME, hint: 'quiet-otter-x7k2pq' },
    ],
  });
});

test('a pipe cannot be asked which of two, so it is told to say which by slug', async () => {
  const attempt = selectApp({
    api: apiListing([OTTER, OTHER_OTTER]),
    name: NAME,
    interactive: false,
  });

  await expect(attempt).rejects.toThrow(
    `2 apps are named ${NAME}. Say which by its slug: ${SLUG}, quiet-otter-x7k2pq.`,
  );
});

test('a slug in the flag is that app, which is how two of one name are told apart', async () => {
  const app = await selectApp({
    api: apiListing([OTTER, OTHER_OTTER]),
    name: 'quiet-otter-x7k2pq',
    interactive: false,
  });

  expect(app).toEqual({ id: 'app-3', name: NAME });
});

test('a flag naming nothing is said to name nothing', async () => {
  const attempt = selectApp({ api: apiListing([OTTER]), name: 'Loud Badger', interactive: true });

  await expect(attempt).rejects.toThrow('No app named Loud Badger.');
});

test('an owner at a terminal is asked which app rather than told to name one', async () => {
  prompts.answers.chosen = APP_ID;

  const app = await selectApp({
    api: apiListing([OTTER, BADGER]),
    name: undefined,
    interactive: true,
  });

  expect(app).toEqual({ id: APP_ID, name: NAME });
  expect(prompts.asked[0]?.message).toBe('Which app?');
  expect(prompts.asked[0]).toMatchObject({
    options: [
      { value: APP_ID, label: NAME, hint: SLUG },
      { value: 'app-2', label: 'Loud Badger', hint: 'loud-badger-k1wegy · suspended' },
    ],
  });
});

test('a pipe has nobody to ask, so it is told which flag names one', async () => {
  const attempt = selectApp({ api: apiListing([OTTER]), name: undefined, interactive: false });

  await expect(attempt).rejects.toThrow('Which app? Name one with --app.');
  expect(listings).toBe(0);
});

test('an owner with no apps is told what makes one, not shown an empty list', async () => {
  const attempt = selectApp({ api: apiListing([]), name: undefined, interactive: true });

  await expect(attempt).rejects.toThrow('You have no apps.');
  expect(prompts.asked).toEqual([]);
});

test('walking away from the question is not answering it', async () => {
  prompts.answers.chosen = Symbol('cancel');

  const attempt = selectApp({ api: apiListing([OTTER]), name: undefined, interactive: true });

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
    appId: APP_ID,
    deploymentId: undefined,
    operation: 'logs',
    print: printingDim(dimmed),
  });

  expect(addressed).toMatchObject({
    appId: APP_ID,
    deploymentId: 'deployment-2',
    name: NAME,
  });
  expect(dimmed).toEqual([`${NAME} · deployment deployment-2`]);
});

// The wait is the whole command, so what the app's state says about it is said before the first
// line rather than after however many the store held.
test('an app with nothing to read is refused before the stream is opened', async () => {
  const dimmed: string[] = [];

  const attempt = announcedDeployment({
    api: apiRunning({ deployments: [] }),
    appId: APP_ID,
    deploymentId: undefined,
    operation: 'logs',
    print: printingDim(dimmed),
  });

  await expect(attempt).rejects.toThrow(
    `App ${NAME} has never been deployed, so there is no output to read.`,
  );
  expect(dimmed).toEqual([]);
});

test('an app that is running is one whose output is worth waiting on', async () => {
  const addressed = await announcedDeployment({
    api: apiRunning(),
    appId: APP_ID,
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
    appId: APP_ID,
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
    appId: APP_ID,
    deploymentId: 'deployment-1',
    operation: 'logs',
    print: printingDim([]),
  });

  expect(stillWriting(addressed)).toBe(false);
});
