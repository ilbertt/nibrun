import { expect, test } from 'bun:test';
import type { CronListing } from '@repo/api-client/models';
import { CRONS_OUTPUT, listCrons } from '#lib/crons.ts';
import {
  apiHolding,
  deploymentsHolding,
  listedApp,
  RUNNING_DEPLOYMENT,
} from '#tests/support/api.ts';
import { APP_ID } from '#tests/support/app.ts';
import { writerRecording } from '#tests/support/output.ts';

const FIRST_JOB = { jobId: 'cron-1', schedule: '*/5 * * * *', command: './app cleanup' };

const LISTING = {
  appId: APP_ID,
  deploymentId: RUNNING_DEPLOYMENT.id,
  enabled: true,
  timeZone: 'UTC' as const,
  jobs: [FIRST_JOB, { jobId: 'cron-2', schedule: '@daily', command: './app cleanup' }],
} as CronListing;

function cronApi({
  state = 'active',
  deployments = [RUNNING_DEPLOYMENT],
  enabled = true,
  failure,
}: {
  state?: string;
  deployments?: Array<{ id: string; state: string; instanceState?: string }>;
  enabled?: boolean;
  failure?: string;
} = {}) {
  const requests: string[] = [];
  const routes = Object.assign(
    ({ deploymentId }: { deploymentId: string }) => ({
      crons: {
        get: () => {
          requests.push(deploymentId);
          return Promise.resolve(
            failure === undefined
              ? { data: { ...LISTING, deploymentId, enabled }, error: null }
              : { data: null, error: { status: 504, value: { error: failure } } },
          );
        },
      },
    }),
    deploymentsHolding(deployments),
  );
  return {
    requests,
    api: apiHolding({ apps: [listedApp({ state })], underApp: () => ({ deployments: routes }) }),
  };
}

test('reads the newest deployment by default and honors an explicit deployment', async () => {
  const { api, requests } = cronApi();
  const print = writerRecording();
  expect(await listCrons({ api, appId: APP_ID, deploymentId: undefined, print })).toEqual(LISTING);
  await listCrons({ api, appId: APP_ID, deploymentId: 'deployment-2', print });
  expect(requests).toEqual([RUNNING_DEPLOYMENT.id, 'deployment-2']);
});

test('suspended jobs remain inspectable with execution disabled', async () => {
  const { api } = cronApi({
    state: 'suspended',
    enabled: false,
    deployments: [{ id: RUNNING_DEPLOYMENT.id, state: 'stopped' }],
  });
  const listing = await listCrons({
    api,
    appId: APP_ID,
    deploymentId: undefined,
    print: writerRecording(),
  });
  expect(listing.enabled).toBe(false);
  expect(listing.jobs).toEqual(LISTING.jobs);
});

test('idle apps can read registrations without requiring a running guest', async () => {
  const { api } = cronApi({ deployments: [{ ...RUNNING_DEPLOYMENT, instanceState: 'idle' }] });
  expect(
    await listCrons({ api, appId: APP_ID, deploymentId: undefined, print: writerRecording() }),
  ).toEqual(LISTING);
});

test('undeployed and deleting apps fail before requesting cron registrations', async () => {
  for (const input of [{ deployments: [] }, { state: 'deleting' }]) {
    const { api, requests } = cronApi(input);
    await expect(
      listCrons({ api, appId: APP_ID, deploymentId: undefined, print: writerRecording() }),
    ).rejects.toThrow();
    expect(requests).toEqual([]);
  }
});

test('an unavailable agent is reported as a failure rather than an empty table', async () => {
  const { api } = cronApi({ failure: 'Agent did not answer.' });
  await expect(
    listCrons({ api, appId: APP_ID, deploymentId: undefined, print: writerRecording() }),
  ).rejects.toThrow('Agent did not answer.');
});

test('the output projection excludes cron environment variables from both formats', () => {
  const value = CRONS_OUTPUT.schema.parse({
    ...LISTING,
    jobs: [{ ...FIRST_JOB, environment: { TOKEN: 'secret' } }],
  });
  expect(value.jobs).toEqual([FIRST_JOB]);
  const out = writerRecording();
  CRONS_OUTPUT.render({ value, out });
  expect(out.said.join('\n')).not.toContain('secret');
});

test('the human listing preserves duplicate commands and distinguishes them by job ID', () => {
  const out = writerRecording();
  CRONS_OUTPUT.render({ value: LISTING, out });
  expect(out.said).toEqual([
    'Cron execution enabled · UTC',
    'cron-1 · */5 * * * *',
    '  ./app cleanup',
    'cron-2 · @daily',
    '  ./app cleanup',
  ]);
});

test('empty registrations and disabled execution are shown independently', () => {
  const out = writerRecording();
  CRONS_OUTPUT.render({ value: { ...LISTING, enabled: false, jobs: [] }, out });
  expect(out.said).toEqual(['Cron execution disabled · UTC', 'No cron jobs registered.']);
});
