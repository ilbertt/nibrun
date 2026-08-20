import { afterEach, describe, expect, test } from 'bun:test';
import type { PublicApiClient } from '@repo/api-client/public';
import type { Filename } from '@repo/protocol';
import { type DeployStep, deploy, describeUnservedDeployment } from '#deploy.ts';
import type { UploadProgress } from '#upload.ts';

const SLUG = 'quiet-otter';
const APP_ID = 'app-1';
const ARTIFACT_ID = 'artifact-1';
const DIGEST = 'sha256:abcd';
const PUT_URL = 'https://store.example/artifact-1?signature=x';
const PORT = 8080;
const SIZE_BYTES = 1_048_576;
const PART_BYTES = 262_144;
const REFUSED = 403;

type Sent = { what: string; body?: unknown };
type HostnameRow = { hostname: string; kind: string; state: string };

const PLATFORM: HostnameRow = { hostname: `${SLUG}.nibrun.app`, kind: 'platform', state: 'active' };
const PENDING_CUSTOM: HostnameRow = {
  hostname: 'not-pointed-here-yet.example',
  kind: 'custom',
  state: 'pending',
};

function apiHolding({
  apps,
  sent,
  completed = { id: ARTIFACT_ID, digest: DIGEST },
  hostnames = [PENDING_CUSTOM, PLATFORM],
}: {
  apps: Array<{ id: string; slug: string }>;
  sent: Sent[];
  completed?: { id: string; digest: string } | null;
  hostnames?: HostnameRow[];
}): PublicApiClient {
  function app(id: string) {
    return { id, slug: SLUG, hostnames };
  }

  function addressed({ appId }: { appId: string }) {
    function artifact() {
      return {
        patch: (body: unknown) => {
          sent.push({ what: 'artifact patch', body });
          return Promise.resolve({ data: completed, error: null });
        },
      };
    }
    return {
      patch: (body: unknown) => {
        sent.push({ what: 'app patch', body });
        return Promise.resolve({ data: app(appId), error: null });
      },
      artifacts: Object.assign(artifact, {
        post: (body: unknown) => {
          sent.push({ what: 'artifact', body });
          return Promise.resolve({ data: { artifactId: ARTIFACT_ID, url: PUT_URL }, error: null });
        },
      }),
      deployments: {
        post: (body: unknown) => {
          sent.push({ what: 'deployment', body });
          return Promise.resolve({ data: { id: 'deployment-1' }, error: null });
        },
      },
    };
  }

  const route = Object.assign(addressed, {
    get: () => Promise.resolve({ data: { apps }, error: null }),
    post: (body: unknown) => {
      sent.push({ what: 'create', body });
      return Promise.resolve({ data: app(APP_ID), error: null });
    },
  });
  return { api: { apps: route } } as unknown as PublicApiClient;
}

function binary() {
  return { name: 'my-server' as Filename, body: new Blob([new Uint8Array(SIZE_BYTES)]) };
}

const REAL_FETCH = globalThis.fetch;

/** The object store the presigned url points at, and what every request to it is answered with. */
function storeAnswering({ refuses, sent }: { refuses?: boolean; sent: Sent[] }): void {
  globalThis.fetch = ((url: string) => {
    sent.push({ what: 'put', body: url });
    if (refuses === true) {
      return Promise.resolve(
        new Response('<Error><Message>the length is not what was signed</Message></Error>', {
          status: REFUSED,
        }),
      );
    }
    return Promise.resolve(new Response(''));
  }) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
});

test('a slug names the app the release lands on', async () => {
  const sent: Sent[] = [];
  storeAnswering({ sent });

  const deployed = await deploy({
    api: apiHolding({ apps: [{ id: APP_ID, slug: SLUG }], sent }),
    binary: binary(),
    args: [],
    app: SLUG,
  });

  expect(sent.map((each) => each.what)).toEqual([
    'app patch',
    'artifact',
    'put',
    'artifact patch',
    'deployment',
  ]);
  expect(deployed).toEqual({
    appId: APP_ID,
    slug: SLUG,
    deploymentId: 'deployment-1',
    url: `https://${SLUG}.nibrun.app`,
  });
});

test('a domain the owner brought is the address handed back, once it is serving', async () => {
  const sent: Sent[] = [];
  storeAnswering({ sent });

  const deployed = await deploy({
    api: apiHolding({
      apps: [{ id: APP_ID, slug: SLUG }],
      sent,
      hostnames: [PLATFORM, { hostname: 'shop.example.com', kind: 'custom', state: 'active' }],
    }),
    binary: binary(),
    args: [],
    app: SLUG,
  });

  expect(deployed.url).toBe('https://shop.example.com');
});

// The link is offered the moment the deploy lands, and a brought domain is pending until the edge
// holds a certificate for it — so preferring one too early hands out an address that does not
// resolve.
test('a domain still waiting on its records is not the one handed back', async () => {
  const sent: Sent[] = [];
  storeAnswering({ sent });

  const deployed = await deploy({
    api: apiHolding({ apps: [{ id: APP_ID, slug: SLUG }], sent }),
    binary: binary(),
    args: [],
    app: SLUG,
  });

  expect(deployed.url).toBe(`https://${SLUG}.nibrun.app`);
});

test('naming no app creates one, named after the binary when nothing else says', async () => {
  const sent: Sent[] = [];
  storeAnswering({ sent });

  await deploy({ api: apiHolding({ apps: [], sent }), binary: binary(), args: [] });

  expect(sent[0]).toMatchObject({ what: 'create', body: { name: 'my-server' } });
});

// A deployment snapshots the app's config as it stands, so the flags a caller just typed only run
// if they were written first.
test('config is written before the deployment that snapshots it', async () => {
  const sent: Sent[] = [];
  storeAnswering({ sent });

  await deploy({
    api: apiHolding({ apps: [{ id: APP_ID, slug: SLUG }], sent }),
    binary: binary(),
    args: ['serve'],
    app: SLUG,
    port: PORT,
  });

  expect(sent[0]).toEqual({ what: 'app patch', body: { args: ['serve'], guestPort: PORT } });
  expect(sent.at(-1)?.what).toBe('deployment');
});

describe('the bytes go to the store, and the api is told how that went', () => {
  test('the length is said before the url is asked for, and the bytes go there', async () => {
    const sent: Sent[] = [];
    storeAnswering({ sent });

    await deploy({
      api: apiHolding({ apps: [{ id: APP_ID, slug: SLUG }], sent }),
      binary: binary(),
      args: [],
      app: SLUG,
    });

    expect(sent[1]).toEqual({
      what: 'artifact',
      body: { filename: 'my-server', sizeBytes: SIZE_BYTES },
    });
    expect(sent[2]).toEqual({ what: 'put', body: PUT_URL });
    expect(sent[3]).toEqual({ what: 'artifact patch', body: { upload: 'complete' } });
  });

  // Only this end watched the upload happen, so an artifact whose bytes never arrived is one
  // nothing else can find out about.
  test('a refused upload is reported as failed and still raised', async () => {
    const sent: Sent[] = [];
    storeAnswering({ refuses: true, sent });

    const attempt = deploy({
      api: apiHolding({ apps: [{ id: APP_ID, slug: SLUG }], sent }),
      binary: binary(),
      args: [],
      app: SLUG,
    });

    await expect(attempt).rejects.toThrow('the length is not what was signed');
    expect(sent.at(-1)).toEqual({ what: 'artifact patch', body: { upload: 'failed' } });
  });

  test('an upload the api abandoned is not read as an artifact', async () => {
    const sent: Sent[] = [];
    storeAnswering({ sent });

    const attempt = deploy({
      api: apiHolding({ apps: [{ id: APP_ID, slug: SLUG }], sent, completed: null }),
      binary: binary(),
      args: [],
      app: SLUG,
    });

    await expect(attempt).rejects.toThrow(
      'The api accepted the upload without saying what it stored.',
    );
  });
});

describe('what a caller is told as it happens', () => {
  test('each step, in the order it was taken', async () => {
    const steps: DeployStep[] = [];
    storeAnswering({ sent: [] });

    await deploy({
      api: apiHolding({ apps: [{ id: APP_ID, slug: SLUG }], sent: [] }),
      binary: binary(),
      args: [],
      app: SLUG,
      onStep: (step) => steps.push(step),
    });

    expect(steps).toEqual([
      { kind: 'app', appId: APP_ID, slug: SLUG },
      { kind: 'artifact', artifactId: ARTIFACT_ID, digest: DIGEST },
      { kind: 'deployment', deploymentId: 'deployment-1' },
    ]);
  });

  // A surface shows the wait its own way, and the upload is the only part long enough to need one.
  test('the upload is handed to whoever is showing the wait', async () => {
    const waits: string[] = [];
    storeAnswering({ sent: [] });

    await deploy({
      api: apiHolding({ apps: [{ id: APP_ID, slug: SLUG }], sent: [] }),
      binary: binary(),
      args: [],
      app: SLUG,
      whileUploading: ({ message, task }) => {
        waits.push(message);
        return task(() => {});
      },
    });

    expect(waits).toEqual(['uploading my-server (1.0 MB)']);
  });

  // The wait is the only thing that can say the upload is moving, and on a slow link that is the
  // difference between a long upload and one that looks like a hung terminal.
  test('how far the upload has gone reaches whoever is showing the wait', async () => {
    const seen: UploadProgress[] = [];

    await deploy({
      api: apiHolding({ apps: [{ id: APP_ID, slug: SLUG }], sent: [] }),
      binary: binary(),
      args: [],
      app: SLUG,
      upload: ({ body, onProgress }) => {
        onProgress({ sentBytes: PART_BYTES, totalBytes: body.size });
        onProgress({ sentBytes: body.size, totalBytes: body.size });
        return Promise.resolve(new Response(''));
      },
      whileUploading: ({ task }) => task((progress) => seen.push(progress)),
    });

    expect(seen).toEqual([
      { sentBytes: PART_BYTES, totalBytes: SIZE_BYTES },
      { sentBytes: SIZE_BYTES, totalBytes: SIZE_BYTES },
    ]);
  });

  test('the url the api signed is the one the bytes are sent to', async () => {
    const asked: string[] = [];

    await deploy({
      api: apiHolding({ apps: [{ id: APP_ID, slug: SLUG }], sent: [] }),
      binary: binary(),
      args: [],
      app: SLUG,
      upload: ({ url }) => {
        asked.push(url);
        return Promise.resolve(new Response(''));
      },
    });

    expect(asked).toEqual([PUT_URL]);
  });
});

describe('a release that settled without serving accounts for itself', () => {
  test("the host's own words are carried through where it left any", () => {
    expect(
      describeUnservedDeployment({
        id: 'dep-1',
        state: 'failed',
        message: 'No host started this deployment in time.',
      }),
    ).toBe('Deployment dep-1 is failed. No host started this deployment in time.');
  });

  // A release can end without the host having said anything about it, and a trailing separator
  // dangling off the state would read as an account that went missing.
  test('and one that said nothing still names the state it reached', () => {
    expect(describeUnservedDeployment({ id: 'dep-1', state: 'superseded' })).toBe(
      'Deployment dep-1 is superseded.',
    );
  });
});
