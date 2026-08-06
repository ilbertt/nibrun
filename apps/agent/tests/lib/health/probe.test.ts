import { describe, expect, test } from 'bun:test';
import { FetchHttpClient } from '@effect/platform';
import {
  DEFAULT_HEALTH_CHECK,
  GuestPortSchema,
  type HealthCheck,
  Ipv4AddressSchema,
  Value,
} from '@repo/protocol';
import { Effect } from 'effect';
import { probeInstance } from '#lib/health/probe.ts';
import { provided } from '#tests/support/run.ts';
import { HTTP_SERVER_ERROR, serving } from '#tests/support/server.ts';

const LOOPBACK = Value.Parse(Ipv4AddressSchema, '127.0.0.1');
// Nothing listens here, so a probe against it must fail rather than hang.
const CLOSED_PORT = Value.Parse(GuestPortSchema, 1);
const WITH_PATH: HealthCheck = { ...DEFAULT_HEALTH_CHECK, path: '/health' };

const run = provided(FetchHttpClient.layer);

function probing({
  healthCheck,
  answer = () => new Response('ok'),
}: {
  healthCheck: HealthCheck;
  answer?: () => Response;
}) {
  return Effect.gen(function* () {
    const server = yield* serving(answer);
    return yield* probeInstance({
      guestIpv4: LOOPBACK,
      guestPort: Value.Parse(GuestPortSchema, server.port),
      healthCheck,
    });
  });
}

// Against a real socket rather than a stub: what this asks of the platform is exactly the part
// that cannot be checked by asserting a call shape.
describe('the default probe asks only whether the tenant accepts a connection', () => {
  test('a listening port is healthy', async () => {
    expect(await run(probing({ healthCheck: DEFAULT_HEALTH_CHECK }))).toBe(true);
  });

  test('a port nothing listens on is not', async () => {
    expect(
      await run(
        probeInstance({
          guestIpv4: LOOPBACK,
          guestPort: CLOSED_PORT,
          healthCheck: DEFAULT_HEALTH_CHECK,
        }),
      ),
    ).toBe(false);
  });
});

describe('a declared path upgrades the probe to an HTTP GET', () => {
  test('2xx is healthy', async () => {
    expect(await run(probing({ healthCheck: WITH_PATH }))).toBe(true);
  });

  test('a listening tenant answering 500 is not', async () => {
    expect(
      await run(
        probing({
          healthCheck: WITH_PATH,
          answer: () => new Response('down', { status: HTTP_SERVER_ERROR }),
        }),
      ),
    ).toBe(false);
  });
});
