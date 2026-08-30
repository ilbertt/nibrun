import { afterEach, describe, expect, test } from 'bun:test';
import type { PublicApiClient } from '@repo/api-client/public';
import type { Filename } from '@repo/protocol';
import { deploy } from '#deploy.ts';
import type { DeployStep } from '#release.ts';
import { answering } from '#tests/support/api.ts';
import {
  APP_ID,
  ARTIFACT_ID,
  DIGEST,
  type HostnameRow,
  PLATFORM,
  SLUG,
} from '#tests/support/app.ts';
import type { UploadProgress } from '#upload.ts';

const PUT_URL = 'https://store.example/artifact-1?signature=x';
const PORT = 8080;
const SIZE_BYTES = 1_048_576;
const PART_BYTES = 262_144;
const REFUSED = 403;

type Sent = { what: string; body?: unknown };

const PENDING_CUSTOM: HostnameRow = {
  hostname: 'not-pointed-here-yet.example',
  kind: 'custom',
  state: 'pending',
};

function apiHolding({
  apps,
  sent,
  completed = { id: ARTIFACT_ID, digest: DIGEST },
  created = { artifactId: ARTIFACT_ID, url: PUT_URL },
  hostnames = [PENDING_CUSTOM, PLATFORM],
}: {
  apps: Array<{ id: string; slug: string; state?: string }>;
  sent: Sent[];
  completed?: { id: string; digest: string } | null;
  // Somewhere to send bytes, or the artifact those bytes already made: one endpoint answers both,
  // and which one a caller is owed is decided by what it asked for.
  created?: { artifactId: string; url: string } | { id: string; digest: string };
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
          return Promise.resolve({ data: created, error: null });
        },
      }),
      deployments: {
        // What the app is on is read to decide whether it can take a release; nothing is sent by
        // asking, so it is not among what was.
        get: answering({ deployments: [] }),
        post: (body: unknown) => {
          sent.push({ what: 'deployment', body });
          return Promise.resolve({ data: { id: 'deployment-1' }, error: null });
        },
      },
    };
  }

  const route = Object.assign(addressed, {
    get: answering({ apps }),
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

// Nothing downstream would refuse the deployment — it would sit pending for as long as the app
// stays down — and the upload is the half of this that costs, so the refusal comes before it.
test('a suspended app is refused before its binary goes anywhere', async () => {
  const sent: Sent[] = [];
  storeAnswering({ sent });

  const attempt = deploy({
    api: apiHolding({ apps: [{ id: APP_ID, slug: SLUG, state: 'suspended' }], sent }),
    binary: binary(),
    args: [],
    app: SLUG,
  });

  await expect(attempt).rejects.toThrow(
    'App quiet-otter is suspended, so a new release would never start. Resume it first.',
  );
  expect(sent).toEqual([]);
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

// The api refuses a value naming a port the app has not, so a first deploy asking for one and
// naming it has to carry both in the request that creates the app rather than in two.
test('an app created asking for a public port asks for it in the same request', async () => {
  const sent: Sent[] = [];
  storeAnswering({ sent });

  await deploy({
    api: apiHolding({ apps: [], sent }),
    binary: binary(),
    args: [],
    extraPublicPort: true,
  });

  expect(sent[0]).toMatchObject({ what: 'create', body: { config: { hasExtraPublicPort: true } } });
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

  expect(sent[0]).toEqual({ what: 'app patch', body: { args: ['serve'], httpPort: PORT } });
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

const BINARY_URL = 'https://releases.test/v1.2.0/my-server';
const FETCHED = { id: ARTIFACT_ID, digest: DIGEST };

/**
 * A release asset is served by a store that answers no cross-origin request, so the end that can
 * read one is the api. Nothing is sent from here at all: the bytes travel once, between the two
 * ends that are not this one.
 */
describe('a binary the api fetches is never sent from this end', () => {
  test('the url is asked for and the artifact comes back, with nothing put anywhere', async () => {
    const sent: Sent[] = [];
    storeAnswering({ sent });

    const deployed = await deploy({
      api: apiHolding({ apps: [{ id: APP_ID, slug: SLUG }], sent, created: FETCHED }),
      binary: { url: BINARY_URL },
      args: [],
      app: SLUG,
    });

    expect(sent.map((each) => each.what)).toEqual(['app patch', 'artifact', 'deployment']);
    expect(sent[1]).toEqual({ what: 'artifact', body: { url: BINARY_URL } });
    expect(deployed.deploymentId).toBe('deployment-1');
  });

  test('an app made for one is named after the file at the end of the url', async () => {
    const sent: Sent[] = [];

    await deploy({
      api: apiHolding({ apps: [], sent, created: FETCHED }),
      binary: { url: BINARY_URL },
      args: [],
    });

    expect(sent[0]).toMatchObject({ what: 'create', body: { name: 'my-server' } });
  });

  // The api names the artifact from the url's *path*, so a name read out of one any other way is
  // one it will refuse — after this end has already made the app the caller is then left to delete.
  test('a url with no path is refused before an app is made for it', async () => {
    const sent: Sent[] = [];

    await expect(
      deploy({
        api: apiHolding({ apps: [], sent, created: FETCHED }),
        binary: { url: 'https://releases.test' },
        args: [],
      }),
    ).rejects.toThrow('An app needs a name');
    expect(sent).toEqual([]);
  });

  test('and neither does one that ends in a slash name anything', async () => {
    const sent: Sent[] = [];

    await expect(
      deploy({
        api: apiHolding({ apps: [], sent, created: FETCHED }),
        binary: { url: 'https://releases.test/downloads/' },
        args: [],
      }),
    ).rejects.toThrow('An app needs a name');
    expect(sent).toEqual([]);
  });

  test('a name given outright is the name, whatever the url ends in', async () => {
    const sent: Sent[] = [];

    await deploy({
      api: apiHolding({ apps: [], sent, created: FETCHED }),
      binary: { url: 'https://releases.test' },
      args: [],
      name: 'chosen',
    });

    expect(sent[0]).toMatchObject({ what: 'create', body: { name: 'chosen' } });
  });

  test('an api that answers a fetch with somewhere to upload has not agreed', async () => {
    const sent: Sent[] = [];

    await expect(
      deploy({
        api: apiHolding({ apps: [{ id: APP_ID, slug: SLUG }], sent }),
        binary: { url: BINARY_URL },
        args: [],
        app: SLUG,
      }),
    ).rejects.toThrow('The api answered a fetched binary with somewhere to upload one.');
  });

  test('nor has one that answers an upload with an artifact nobody sent it', async () => {
    const sent: Sent[] = [];
    storeAnswering({ sent });

    await expect(
      deploy({
        api: apiHolding({ apps: [{ id: APP_ID, slug: SLUG }], sent, created: FETCHED }),
        binary: binary(),
        args: [],
        app: SLUG,
      }),
    ).rejects.toThrow('The api answered an upload with an artifact nobody sent it.');
  });
});
