import { expect, test } from 'bun:test';
import { GuestPathSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Effect } from 'effect';
import { makeNibrunnerFilesystem } from '#lib/nibrunner/filesystem.ts';
import { APP_ID } from '#tests/support/fixtures.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';
import { servingUnix } from '#tests/support/server.ts';

const run = provided(platform);
const ROOT = Value.Parse(GuestPathSchema, '/');
const OVERSIZED_RESPONSE_BYTES = 1_048_577;

test('filesystem listings reach the native socket and expose only the app data directory', async () => {
  await run(
    Effect.gen(function* () {
      const directory = yield* temporaryDirectory;
      const socketPath = `${directory}/filesystem.sock`;
      const paths: string[] = [];
      yield* servingUnix({
        socketPath,
        handler: function listing(request) {
          const url = new URL(request.url);
          expect(request.method).toBe('GET');
          expect(url.pathname).toBe(`/apps/${APP_ID}/files`);
          const path = url.searchParams.get('path');
          expect(path).not.toBeNull();
          paths.push(path ?? '');
          return Response.json({ path, entries: [], truncated: false });
        },
      });
      const filesystem = makeNibrunnerFilesystem({ socketPath });
      for (const path of ['/', '/a directory/日本語&x=1']) {
        const requested = Value.Parse(GuestPathSchema, path);
        expect(yield* filesystem.list({ appId: APP_ID, path: requested })).toEqual({
          path: requested,
          entries: [],
          truncated: false,
        });
      }
      expect(paths).toEqual(['/app/data', '/app/data/a directory/日本語&x=1']);
    }),
  );
});

test.each([
  { name: 'a refusal', status: 403, body: { message: 'private host path and tenant secret' } },
  { name: 'malformed JSON', status: 200, body: 'not-json' },
  {
    name: 'a different path',
    status: 200,
    body: { path: '/elsewhere', entries: [], truncated: false },
  },
  {
    name: 'malformed entries',
    status: 200,
    body: { path: '/app/data', entries: [{}], truncated: false },
  },
  { name: 'an oversized reply', status: 200, body: 'x'.repeat(OVERSIZED_RESPONSE_BYTES) },
])('filesystem browsing rejects $name', async ({ status, body }) => {
  await run(
    Effect.gen(function* () {
      const directory = yield* temporaryDirectory;
      const socketPath = `${directory}/filesystem.sock`;
      yield* servingUnix({
        socketPath,
        handler: () =>
          typeof body === 'string'
            ? new Response(body, { status })
            : Response.json(body, { status }),
      });
      const failure = yield* Effect.flip(
        makeNibrunnerFilesystem({ socketPath }).list({ appId: APP_ID, path: ROOT }),
      );
      expect(failure.message).not.toContain('private host path');
      expect(failure.message).not.toContain('tenant secret');
    }),
  );
});
