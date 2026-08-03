import { describe, expect, test } from 'bun:test';
import { DEFAULT_HEALTH_CHECK, type GuestPort, type Ipv4Address } from '@repo/protocol';
import { probeInstance } from '#health/probe.ts';

const LOOPBACK = '127.0.0.1' as Ipv4Address;
// Nothing listens here, so a probe against it must fail rather than hang.
const CLOSED_PORT = 1 as GuestPort;

const withServer = async ({
  run,
  fetch = () => new Response('ok'),
}: {
  run: (port: GuestPort) => Promise<void>;
  fetch?: () => Response;
}) => {
  const server = Bun.serve({ port: 0, hostname: LOOPBACK, fetch });
  try {
    await run(server.port as GuestPort);
  } finally {
    await server.stop(true);
  }
};

// Against a real socket rather than a stub: what this asks of Bun's client is exactly the part
// that cannot be checked by asserting a call shape.
describe('the default probe asks only whether the tenant accepts a connection', () => {
  test('a listening port is healthy', async () => {
    await withServer({
      run: async (guestPort) => {
        expect(
          await probeInstance({
            guestIpv4: LOOPBACK,
            guestPort,
            healthCheck: DEFAULT_HEALTH_CHECK,
          }),
        ).toBe(true);
      },
    });
  });

  test('a port nothing listens on is not', async () => {
    expect(
      await probeInstance({
        guestIpv4: LOOPBACK,
        guestPort: CLOSED_PORT,
        healthCheck: DEFAULT_HEALTH_CHECK,
      }),
    ).toBe(false);
  });
});

describe('a declared path upgrades the probe to an HTTP GET', () => {
  test('2xx is healthy', async () => {
    await withServer({
      run: async (guestPort) => {
        expect(
          await probeInstance({
            guestIpv4: LOOPBACK,
            guestPort,
            healthCheck: { ...DEFAULT_HEALTH_CHECK, path: '/health' },
          }),
        ).toBe(true);
      },
    });
  });

  test('a listening tenant answering 500 is not', async () => {
    await withServer({
      fetch: () => new Response('down', { status: 500 }),
      run: async (guestPort) => {
        expect(
          await probeInstance({
            guestIpv4: LOOPBACK,
            guestPort,
            healthCheck: { ...DEFAULT_HEALTH_CHECK, path: '/health' },
          }),
        ).toBe(false);
      },
    });
  });
});
