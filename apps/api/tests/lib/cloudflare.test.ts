import { afterEach, describe, expect, test } from 'bun:test';
import { CloudflareClient, CloudflareError } from '#lib/cloudflare/client.ts';

const ZONE_ID = 'zone-1';
const API_TOKEN = 'token-1';
const HOSTNAME = 'app.example.dev';
const HTTP_OK = 200;
const HTTP_BAD_GATEWAY = 502;

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

type Answer = { status?: number; body: unknown };

/** Records what was asked and answers with what the test wants back. */
function answering(answers: Answer[]): { calls: Request[] } {
  const calls: Request[] = [];
  let index = 0;

  globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
    const [input, init] = args;
    calls.push(new Request(input as string, init));
    const answer = answers[index++] ?? answers.at(-1);
    return Promise.resolve(
      new Response(JSON.stringify(answer?.body), { status: answer?.status ?? HTTP_OK }),
    );
  }) as typeof fetch;

  return { calls };
}

function client(): CloudflareClient {
  return new CloudflareClient({ apiToken: API_TOKEN, zoneId: ZONE_ID });
}

function ok(result: unknown): Answer {
  return { body: { success: true, result, errors: [] } };
}

describe('a call to the edge carries this zone and this token', () => {
  test('the hostname is created under the configured zone', async () => {
    const { calls } = answering([ok({ id: 'ch-1' })]);

    await client().createCustomHostname({ hostname: HOSTNAME });

    expect(calls[0]?.url).toBe(
      `https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/custom_hostnames`,
    );
    expect(calls[0]?.headers.get('authorization')).toBe(`Bearer ${API_TOKEN}`);
  });

  // Delegated DCV is what keeps renewal from ever coming back to the owner, and it answers the
  // `txt` method. `http` would need their server rather than their DNS, which is a different
  // promise to the one the dashboard prints them.
  test('and asks for the validation the owner answers once and never again', async () => {
    const { calls } = answering([ok({ id: 'ch-1' })]);

    await client().createCustomHostname({ hostname: HOSTNAME });

    expect(await calls[0]?.json()).toMatchObject({
      hostname: HOSTNAME,
      ssl: { method: 'txt', type: 'dv' },
    });
  });
});

describe('a refusal is an error however the edge phrases it', () => {
  test('a non-2xx is an error', async () => {
    answering([{ status: 403, body: { success: false, result: null, errors: [] } }]);

    await expect(client().createCustomHostname({ hostname: HOSTNAME })).rejects.toBeInstanceOf(
      CloudflareError,
    );
  });

  // Cloudflare answers some failures 200 with `success: false`. Reading only the status code
  // would let those through as a result, and the caller would store an id that is `undefined`.
  test('so is a 200 that says it did not succeed', async () => {
    answering([
      {
        body: { success: false, result: null, errors: [{ code: 1406, message: 'already exists' }] },
      },
    ]);

    await expect(client().createCustomHostname({ hostname: HOSTNAME })).rejects.toThrow(
      /already exists/,
    );
  });

  // An edge that answered with a proxy's error page rather than its own envelope is still a
  // refusal, and reading `.result` off a body that never parsed would be a 500 out of this end.
  test('and so is a body that is not the envelope at all', async () => {
    answering([{ status: HTTP_BAD_GATEWAY, body: undefined }]);

    await expect(client().createCustomHostname({ hostname: HOSTNAME })).rejects.toBeInstanceOf(
      CloudflareError,
    );
  });
});

describe('the record the owner places is derived, not fetched per hostname', () => {
  test('the target names the hostname and the zone delegation uuid', async () => {
    answering([ok({ uuid: 'abc123' })]);

    expect(await client().dcvDelegationTarget({ hostname: HOSTNAME })).toBe(
      `${HOSTNAME}.abc123.dcv.cloudflare.com`,
    );
  });

  // The uuid belongs to the zone rather than to a hostname, so asking again per hostname would be
  // a round trip for an answer that cannot have changed.
  test('and the uuid is asked for once however many hostnames need it', async () => {
    const { calls } = answering([ok({ uuid: 'abc123' })]);
    const cloudflare = client();

    await cloudflare.dcvDelegationTarget({ hostname: HOSTNAME });
    await cloudflare.dcvDelegationTarget({ hostname: 'other.example.dev' });

    expect(calls.length).toBe(1);
  });
});
