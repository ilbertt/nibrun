import { expect, test } from 'bun:test';
import { FileSystem } from '@effect/platform';
import { AgentSessionRequestSchema, AgentSessionSchema, HostVersionsSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Effect } from 'effect';
import { InvalidHostIdentity, openSession } from '#lib/control/session.ts';
import { ControlPlane } from '#services/control-plane.service.ts';
import { agentConfig } from '#tests/support/config.ts';
import { POLL_SETTINGS_FIXTURE } from '#tests/support/fixtures.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';
import { HTTP_UNAVAILABLE, serving } from '#tests/support/server.ts';

const run = provided(platform);
const SESSION = Value.Parse(AgentSessionSchema, {
  hostId: Bun.randomUUIDv7(),
  sessionToken: 'session-token',
  expiresAt: '2026-10-28T20:00:00Z',
  poll: POLL_SETTINGS_FIXTURE,
});
const INPUT = {
  versions: Value.Parse(HostVersionsSchema, {
    agent: 'a',
    guestImage: 'b',
    zerofs: 'c',
    firecracker: 'd',
  }),
  capacity: { vcpuCount: 2, memoryMib: 4096, cacheBytes: 100 },
};

function sessionEndpoint({ hostIdFile, failFirst }: { hostIdFile: string; failFirst: boolean }) {
  return Effect.gen(function* () {
    const requests: string[] = [];
    const persisted: string[] = [];
    const { baseUrl } = yield* serving(async (request) => {
      const body = Value.Parse(AgentSessionRequestSchema, await request.json());
      requests.push(body.hostId);
      persisted.push((await Bun.file(hostIdFile).text()).trim());
      return failFirst && requests.length === 1
        ? new Response(null, { status: HTTP_UNAVAILABLE })
        : Response.json(SESSION);
    });
    const config = agentConfig({ hostIdFile, controlPlaneUrl: baseUrl });
    return {
      requests,
      persisted,
      open: openSession(INPUT).pipe(
        Effect.provide(ControlPlane.DefaultWithoutDependencies),
        Effect.provide(config),
      ),
    };
  });
}

test('the first request carries an identity already persisted and reused on renewal', async () => {
  await run(
    Effect.gen(function* () {
      const hostIdFile = `${yield* temporaryDirectory}/host-id`;
      const endpoint = yield* sessionEndpoint({ hostIdFile, failFirst: false });
      expect(yield* endpoint.open).toEqual(SESSION);
      expect(yield* endpoint.open).toEqual(SESSION);
      const originId = (yield* (yield* FileSystem.FileSystem).readFileString(hostIdFile)).trim();
      expect(originId).not.toBe(SESSION.hostId);
      expect(endpoint.requests).toEqual([originId, originId]);
      expect(endpoint.persisted).toEqual([originId, originId]);
    }),
  );
});

test('a failed first response retries with the same identity after rebuilding the client', async () => {
  await run(
    Effect.gen(function* () {
      const hostIdFile = `${yield* temporaryDirectory}/host-id`;
      const endpoint = yield* sessionEndpoint({ hostIdFile, failFirst: true });
      const failed = yield* Effect.either(endpoint.open);
      expect(failed._tag).toBe('Left');
      expect(yield* endpoint.open).toEqual(SESSION);
      const originId = (yield* (yield* FileSystem.FileSystem).readFileString(hostIdFile)).trim();
      expect(endpoint.requests).toEqual([originId, originId]);
      expect(endpoint.persisted).toEqual([originId, originId]);
    }),
  );
});

test('an invalid persisted identity is preserved and cannot open a session', async () => {
  await run(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const hostIdFile = `${yield* temporaryDirectory}/host-id`;
      yield* fs.writeFileString(hostIdFile, 'invalid host identity');
      const endpoint = yield* sessionEndpoint({ hostIdFile, failFirst: false });
      const error = yield* Effect.flip(endpoint.open);
      expect(error).toBeInstanceOf(InvalidHostIdentity);
      expect(endpoint.requests).toEqual([]);
      expect(yield* fs.readFileString(hostIdFile)).toBe('invalid host identity');
    }),
  );
});

test('failure to persist an identity prevents the first network request', async () => {
  await run(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const blockedDirectory = `${yield* temporaryDirectory}/not-a-directory`;
      yield* fs.writeFileString(blockedDirectory, 'file');
      const endpoint = yield* sessionEndpoint({
        hostIdFile: `${blockedDirectory}/host-id`,
        failFirst: false,
      });
      const failed = yield* Effect.either(endpoint.open);
      expect(failed._tag).toBe('Left');
      expect(endpoint.requests).toEqual([]);
    }),
  );
});
