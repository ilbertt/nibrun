import { describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { FileSystem } from '@effect/platform';
import { SystemError } from '@effect/platform/Error';
import { Effect, Either } from 'effect';
import { CommandTimedOut } from '#lib/exec.ts';
import { appZerofsUnits, startAppZerofs, stopAppZerofs } from '#lib/volumes/app-zerofs-systemd.ts';
import { recordingCommands, succeeding } from '#tests/support/commands.ts';
import { APP_ID } from '#tests/support/fixtures.ts';
import { platform, provided } from '#tests/support/run.ts';

describe('per-app ZeroFS systemd controls', () => {
  test('targets installed templates whose dependencies order startup and shutdown', async () => {
    await provided(platform)(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const units = appZerofsUnits(APP_ID);
        for (const unit of Object.values(units)) {
          const template = unit.replace(APP_ID, '');
          expect(
            yield* fs.exists(
              fileURLToPath(
                new URL(`../../../../../infra/app-host/systemd/${template}`, import.meta.url),
              ),
            ),
          ).toBe(true);
        }
        const mount = yield* fs.readFileString(
          fileURLToPath(
            new URL(
              `../../../../../infra/app-host/systemd/${units.mount.replace(APP_ID, '')}`,
              import.meta.url,
            ),
          ),
        );
        const instance = mount.replaceAll('%i', APP_ID);
        expect(instance).toContain(`BindsTo=${units.server}`);
        expect(instance).toContain(`After=${units.server}`);
        expect(instance).toContain(`PartOf=${units.server}`);
      }),
    );
  });

  test('starts only the app mount and leaves it running after the agent scope closes', async () => {
    const commands = recordingCommands();
    await provided(commands.layer)(startAppZerofs(APP_ID));
    expect(commands.commands).toEqual([
      {
        command: ['systemctl', 'start', 'nibrun-app-zerofs-mount@app-1.service'],
        timeout: '3 minutes',
      },
    ]);
  });

  test('stops both app units in one transaction with time for graceful shutdown', async () => {
    const commands = recordingCommands();
    await provided(commands.layer)(stopAppZerofs(APP_ID));
    expect(commands.commands).toEqual([
      {
        command: [
          'systemctl',
          'stop',
          'nibrun-app-zerofs-mount@app-1.service',
          'nibrun-app-zerofs@app-1.service',
        ],
        timeout: '5 minutes',
      },
    ]);
  });

  test('a failed start reports no subprocess output and leaves existing storage alone', async () => {
    const commands = recordingCommands(() =>
      succeeding({ code: 1, stdout: 'customer-access-key', stderr: 'customer-secret-key' }),
    );
    const result = await provided(commands.layer)(Effect.either(startAppZerofs(APP_ID)));
    expect(Either.isLeft(result) && result.left._tag).toBe('AppZerofsUnitError');
    expect(Either.isLeft(result) && result.left.operation).toBe('start');
    expect(JSON.stringify(result)).not.toContain('customer-access-key');
    expect(JSON.stringify(result)).not.toContain('customer-secret-key');
    expect(commands.commands.map(({ command }) => command)).toEqual([
      ['systemctl', 'start', 'nibrun-app-zerofs-mount@app-1.service'],
    ]);
  });

  test('a missing systemctl is reported without exposing the underlying error', async () => {
    const commands = recordingCommands(() =>
      Effect.fail(
        new SystemError({
          module: 'Command',
          method: 'start',
          reason: 'NotFound',
          description: 'customer-secret-key',
        }),
      ),
    );
    const result = await provided(commands.layer)(Effect.either(startAppZerofs(APP_ID)));
    expect(Either.isLeft(result) && result.left._tag).toBe('AppZerofsUnitError');
    expect(JSON.stringify(result)).not.toContain('customer-secret-key');
  });

  test('a stop timeout is reported without forcing a kill or deleting local state', async () => {
    const commands = recordingCommands((request) =>
      Effect.fail(new CommandTimedOut({ command: request.command })),
    );
    const result = await provided(commands.layer)(Effect.either(stopAppZerofs(APP_ID)));
    expect(Either.isLeft(result) && result.left._tag).toBe('AppZerofsUnitError');
    expect(Either.isLeft(result) && result.left.operation).toBe('stop');
    expect(commands.executables()).toEqual(['systemctl']);
    expect(commands.commands[0]?.command.slice(0, 2)).toEqual(['systemctl', 'stop']);
  });
});
