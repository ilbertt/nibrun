import { expect, test } from 'bun:test';
import {
  AgentSessionSchema,
  FilesystemQueryResultSchema,
  FilesystemQuerySchema,
} from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Effect, Layer } from 'effect';
import { makeControlPlaneClient } from '#lib/control/client.ts';
import { makeNibrunnerFilesystem } from '#lib/nibrunner/filesystem.ts';
import { pollNibrunnerFilesystem } from '#lib/nibrunner/filesystem-query.ts';
import { NibrunnerFilesystem } from '#services/nibrunner-filesystem.service.ts';
import { APP_ID, HOST_ID, POLL_SETTINGS_FIXTURE } from '#tests/support/fixtures.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';
import { serving, servingUnix } from '#tests/support/server.ts';

const run = provided(platform);
const session = Value.Parse(AgentSessionSchema, {
  hostId: HOST_ID,
  sessionToken: 'token',
  expiresAt: '2099-01-01T00:00:00Z',
  poll: POLL_SETTINGS_FIXTURE,
});
const query = Value.Parse(FilesystemQuerySchema, { queryId: 'query', appId: APP_ID, path: '/' });

test.each([true, false])(
  'filesystem queries recheck ownership before reading: still served=%s',
  async (stillServed) => {
    await run(
      Effect.gen(function* () {
        const directory = yield* temporaryDirectory;
        const socketPath = `${directory}/filesystem.sock`;
        let nativeReads = 0;
        yield* servingUnix({
          socketPath,
          handler: function listing() {
            nativeReads += 1;
            return Response.json({ path: '/app/data', entries: [], truncated: false });
          },
        });
        const results: unknown[] = [];
        const { baseUrl } = yield* serving(async function control(request) {
          expect(request.headers.get('authorization')).toBe('Bearer token');
          if (new URL(request.url).pathname.endsWith('/filesystem-query')) {
            expect(await request.json()).toEqual({ servedAppIds: [APP_ID] });
            return Response.json({ result: 'query', query });
          }
          results.push(Value.Parse(FilesystemQueryResultSchema, await request.json()));
          return Response.json({});
        });
        let reads = 0;
        const servedAppIds = Effect.sync(function ownership() {
          reads += 1;
          return reads === 1 || stillServed ? [APP_ID] : [];
        });
        yield* pollNibrunnerFilesystem({
          control: makeControlPlaneClient({ baseUrl }),
          session,
          servedAppIds,
        }).pipe(
          Effect.provide(
            Layer.succeed(
              NibrunnerFilesystem,
              NibrunnerFilesystem.make(makeNibrunnerFilesystem({ socketPath })),
            ),
          ),
        );
        expect(nativeReads).toBe(stillServed ? 1 : 0);
        expect(results).toEqual([
          {
            queryId: query.queryId,
            outcome: stillServed
              ? { status: 'listed', listing: { path: '/', entries: [], truncated: false } }
              : { status: 'failed', message: 'The app filesystem could not be read.' },
          },
        ]);
      }),
    );
  },
);
