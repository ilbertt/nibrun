import { expect, test } from 'bun:test';
import { FileSystem } from '@effect/platform';
import { Deferred, Effect, Fiber, Layer } from 'effect';
import { CommandFailed } from '#lib/exec.ts';
import { renderAppSites } from '#lib/proxy/caddyfile.ts';
import type { RouteTarget } from '#lib/report/routes.ts';
import { CaddyProxy } from '#services/caddy-proxy.service.ts';
import { recordingCommands, succeeding } from '#tests/support/commands.ts';
import { agentConfig } from '#tests/support/config.ts';
import { APP_HOSTNAME, APP_ID, FIRST_HOST_PORT } from '#tests/support/fixtures.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';

const route: RouteTarget = {
  appId: APP_ID,
  hostnames: [APP_HOSTNAME],
  hostPort: FIRST_HOST_PORT,
};
const run = provided(platform);
const RECOVERY_RELOAD_COUNT = 3;

test('concurrent refreshes derive routes only after the preceding reload finishes', () =>
  run(
    Effect.gen(function* () {
      const directory = yield* temporaryDirectory;
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      let loads = 0;
      const commands = recordingCommands(() =>
        Effect.gen(function* () {
          loads += 1;
          if (loads === 1) {
            yield* Deferred.succeed(entered, undefined);
            yield* Deferred.await(release);
          }
          return yield* succeeding();
        }),
      );
      const layer = CaddyProxy.DefaultWithoutDependencies.pipe(
        Layer.provideMerge(agentConfig({ caddySitesFile: `${directory}/sites` })),
        Layer.provideMerge(commands.layer),
      );
      yield* Effect.gen(function* () {
        const proxy = yield* CaddyProxy;
        let current = [route];
        let reads = 0;
        const routes = Effect.sync(function read() {
          reads += 1;
          return current;
        });
        const first = yield* Effect.fork(proxy.apply(routes));
        yield* Deferred.await(entered);
        const second = yield* Effect.fork(proxy.apply(routes));
        yield* Effect.yieldNow();
        expect(reads).toBe(1);
        current = [];
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(first);
        yield* Fiber.join(second);
        expect(loads).toBe(2);
        const fs = yield* FileSystem.FileSystem;
        expect(yield* fs.readFileString(`${directory}/sites`)).toBe(renderAppSites([]));
      }).pipe(Effect.provide(layer));
    }),
  ));

test('a rejected reload is retried even when restoring the last successful routes', () =>
  run(
    Effect.gen(function* () {
      const directory = yield* temporaryDirectory;
      let loads = 0;
      const commands = recordingCommands((request) => {
        loads += 1;
        return loads === 2
          ? Effect.fail(
              new CommandFailed({
                command: request.command,
                result: { code: 1, stdout: '', stderr: 'reload refused' },
              }),
            )
          : succeeding();
      });
      const layer = CaddyProxy.DefaultWithoutDependencies.pipe(
        Layer.provideMerge(agentConfig({ caddySitesFile: `${directory}/sites` })),
        Layer.provideMerge(commands.layer),
      );
      yield* Effect.gen(function* () {
        const proxy = yield* CaddyProxy;
        yield* proxy.apply(Effect.succeed([route]));
        yield* Effect.either(proxy.apply(Effect.succeed([])));
        yield* proxy.apply(Effect.succeed([route]));
        yield* proxy.apply(Effect.succeed([route]));
        expect(loads).toBe(RECOVERY_RELOAD_COUNT);
        const fs = yield* FileSystem.FileSystem;
        expect(yield* fs.readFileString(`${directory}/sites`)).toBe(renderAppSites([route]));
      }).pipe(Effect.provide(layer));
    }),
  ));
