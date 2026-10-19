import { describe, expect, test } from 'bun:test';
import { type AppId, AppIdSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Deferred, Effect, Either, Fiber, Layer } from 'effect';
import { type CommandLine, CommandTimedOut } from '#lib/exec.ts';
import { flushAndStopAppZerofs, flushAppZerofs } from '#lib/volumes/app-zerofs-durability.ts';
import { recordingCommands, succeeding } from '#tests/support/commands.ts';
import { agentConfig } from '#tests/support/config.ts';
import { APP_ID } from '#tests/support/fixtures.ts';
import { provided, runScoped } from '#tests/support/run.ts';

const BINARY = '/opt/test/zerofs';

function host(commands: ReturnType<typeof recordingCommands>) {
  return Layer.merge(
    agentConfig({ stateDir: '/var/lib/nibrun', zerofsBinary: BINARY }),
    commands.layer,
  );
}

function flushCommand(appId: AppId): CommandLine {
  return [BINARY, 'flush', '-c', `/var/lib/nibrun/zerofs/${appId}/config.toml`];
}

describe('per-app ZeroFS durability', () => {
  test('flushing one app uses its private config and leaves its services running', async () => {
    const commands = recordingCommands(() => succeeding({ stdout: 'flush complete' }));
    const result = await provided(host(commands))(flushAppZerofs(APP_ID));
    expect(result).toBeUndefined();
    expect(commands.commands.map(({ command }) => command)).toEqual([flushCommand(APP_ID)]);
  });

  test.each([APP_ID, Value.Parse(AppIdSchema, 'app-2')])(
    'flushes before stopping only the selected app: %s',
    async (appId) => {
      const commands = recordingCommands();
      await provided(host(commands))(flushAndStopAppZerofs(appId));
      expect(commands.commands.map(({ command }) => command)).toEqual([
        flushCommand(appId),
        [
          'systemctl',
          'stop',
          `nibrun-app-zerofs-mount@${appId}.service`,
          `nibrun-app-zerofs@${appId}.service`,
        ],
      ]);
    },
  );

  test('a failed flush leaves the services running and hides subprocess output', async () => {
    const commands = recordingCommands(() =>
      succeeding({ code: 1, stdout: 'customer-access-key', stderr: 'customer-secret-key' }),
    );
    const result = await provided(host(commands))(Effect.either(flushAndStopAppZerofs(APP_ID)));
    expect(Either.isLeft(result) && result.left._tag).toBe('AppZerofsFlushError');
    expect(JSON.stringify(result)).not.toContain('customer-access-key');
    expect(JSON.stringify(result)).not.toContain('customer-secret-key');
    expect(commands.commands.map(({ command }) => command)).toEqual([flushCommand(APP_ID)]);
  });

  test('a flush timeout never issues a stop', async () => {
    const commands = recordingCommands((request) =>
      Effect.fail(new CommandTimedOut({ command: request.command })),
    );
    const result = await provided(host(commands))(Effect.either(flushAndStopAppZerofs(APP_ID)));
    expect(Either.isLeft(result) && result.left._tag).toBe('AppZerofsFlushError');
    expect(commands.commands.map(({ command }) => command)).toEqual([flushCommand(APP_ID)]);
  });

  test('interrupting an in-flight flush never issues a stop during cleanup', async () => {
    await runScoped(
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>();
        const commands = recordingCommands(() =>
          Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
        );
        const draining = yield* Effect.forkScoped(
          flushAndStopAppZerofs(APP_ID).pipe(Effect.provide(host(commands))),
        );
        yield* Deferred.await(entered);
        yield* Fiber.interrupt(draining);
        expect(commands.commands.map(({ command }) => command)).toEqual([flushCommand(APP_ID)]);
      }),
    );
  });

  test('a failed stop remains a stop failure and triggers no destructive recovery', async () => {
    const commands = recordingCommands((request) =>
      succeeding({ code: request.command[0] === 'systemctl' ? 1 : 0 }),
    );
    const result = await provided(host(commands))(Effect.either(flushAndStopAppZerofs(APP_ID)));
    expect(Either.isLeft(result) && result.left._tag).toBe('AppZerofsUnitError');
    expect(commands.executables()).toEqual([BINARY, 'systemctl']);
  });
});
