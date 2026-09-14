import { afterEach, describe, expect, test } from 'bun:test';
import { CloudflareClient, CloudflareError } from '#lib/cloudflare/client.ts';

const ZONE_ID = 'zone-1';
const API_TOKEN = 'token-1';
const HOSTNAME = 'app.example.dev';
const HTTP_OK = 200;
const HTTP_BAD_GATEWAY = 502;
const HTTP_NOT_FOUND = 404;

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

describe('validation is asked for again by sending the same configuration back', () => {
  // The edge reads a PATCH that changes nothing as "run validation now"; sending a different
  // method would change how the hostname is proved instead.
  test('the hostname is patched in place with the method it was registered with', async () => {
    const { calls } = answering([ok({ id: 'ch-1' })]);

    await client().restartValidation({ id: 'ch-1', method: 'http' });

    expect(calls[0]?.method).toBe('PATCH');
    expect(calls[0]?.url).toBe(
      `https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/custom_hostnames/ch-1`,
    );
    expect(await calls[0]?.json()).toEqual({
      ssl: { method: 'http', type: 'dv', settings: { min_tls_version: '1.2' } },
    });
  });
});

describe('a call to the edge carries this zone and this token', () => {
  test('the hostname is created under the configured zone', async () => {
    const { calls } = answering([ok({ id: 'ch-1' })]);

    await client().createCustomHostname({ hostname: HOSTNAME, method: 'txt' });

    expect(calls[0]?.url).toBe(
      `https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/custom_hostnames`,
    );
    expect(calls[0]?.headers.get('authorization')).toBe(`Bearer ${API_TOKEN}`);
  });

  // Which validation is the caller's decision, made per hostname; here it is only carried to the
  // edge in the shape the edge reads it.
  test('and asks for the validation it was told to, as the edge spells it', async () => {
    const { calls } = answering([ok({ id: 'ch-1' }), ok({ id: 'ch-2' })]);

    await client().createCustomHostname({ hostname: HOSTNAME, method: 'txt' });
    await client().createCustomHostname({ hostname: HOSTNAME, method: 'http' });

    expect(await calls[0]?.json()).toMatchObject({
      hostname: HOSTNAME,
      ssl: { method: 'txt', type: 'dv' },
    });
    expect(await calls[1]?.json()).toMatchObject({ ssl: { method: 'http', type: 'dv' } });
  });
});

describe('a refusal is an error however the edge phrases it', () => {
  test('a non-2xx is an error', async () => {
    answering([{ status: 403, body: { success: false, result: null, errors: [] } }]);

    await expect(
      client().createCustomHostname({ hostname: HOSTNAME, method: 'txt' }),
    ).rejects.toBeInstanceOf(CloudflareError);
  });

  // Cloudflare answers some failures 200 with `success: false`. Reading only the status code
  // would let those through as a result, and the caller would store an id that is `undefined`.
  test('so is a 200 that says it did not succeed', async () => {
    answering([
      {
        body: { success: false, result: null, errors: [{ code: 1406, message: 'already exists' }] },
      },
    ]);

    await expect(
      client().createCustomHostname({ hostname: HOSTNAME, method: 'txt' }),
    ).rejects.toThrow(/already exists/);
  });

  // An edge that answered with a proxy's error page rather than its own envelope is still a
  // refusal, and reading `.result` off a body that never parsed would be a 500 out of this end.
  test('and so is a body that is not the envelope at all', async () => {
    answering([{ status: HTTP_BAD_GATEWAY, body: undefined }]);

    await expect(
      client().createCustomHostname({ hostname: HOSTNAME, method: 'txt' }),
    ).rejects.toBeInstanceOf(CloudflareError);
  });
});

describe('deleting a hostname is safe to repeat', () => {
  test('one already absent is the requested outcome', async () => {
    answering([
      {
        status: HTTP_NOT_FOUND,
        body: { success: false, result: null, errors: [{ code: 1436, message: 'not found' }] },
      },
    ]);

    await expect(client().deleteCustomHostname({ id: 'ch-1' })).resolves.toBeUndefined();
  });

  test('other failures still leave the cleanup to retry', async () => {
    answering([{ status: HTTP_BAD_GATEWAY, body: undefined }]);

    await expect(client().deleteCustomHostname({ id: 'ch-1' })).rejects.toBeInstanceOf(
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
