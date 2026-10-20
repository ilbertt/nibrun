import { describe, expect, test } from 'bun:test';
import { Effect, Either } from 'effect';
import { CommandTimedOut } from '#lib/exec.ts';
import { observeAppZerofs } from '#lib/volumes/app-zerofs-observation.ts';
import { recordingCommands, succeeding } from '#tests/support/commands.ts';
import { APP_ID } from '#tests/support/fixtures.ts';
import { provided } from '#tests/support/run.ts';
import { systemdUnitProperties as unit } from '#tests/support/systemd.ts';

const SERVER = 'nibrun-app-zerofs@app-1.service';
const MOUNT = 'nibrun-app-zerofs-mount@app-1.service';

function observation(output: string) {
  const commands = recordingCommands(() => succeeding({ stdout: output }));
  return provided(commands.layer)(observeAppZerofs(APP_ID));
}

describe('read-only observation of per-app ZeroFS services', () => {
  test('matches units by identity when systemd returns them in the opposite order', async () => {
    const commands = recordingCommands(() =>
      succeeding({ stdout: `${unit({ id: MOUNT })}\n\n${unit({ id: SERVER })}\n` }),
    );
    const state = await provided(commands.layer)(observeAppZerofs(APP_ID));
    expect(state).toEqual({
      server: { loadState: 'loaded', activeState: 'active', subState: 'running' },
      mount: { loadState: 'loaded', activeState: 'active', subState: 'running' },
      ready: true,
    });
    expect(commands.commands.map(({ command }) => command)).toEqual([
      ['systemctl', 'show', SERVER, MOUNT, '--property=Id,LoadState,ActiveState,SubState'],
    ]);
  });

  test.each([SERVER, MOUNT])('a unit still activating is not ready: %s', async (id) => {
    const state = await observation(
      [SERVER, MOUNT]
        .map((name) =>
          unit({
            id: name,
            activeState: name === id ? 'activating' : 'active',
            subState: name === id ? 'start-post' : 'running',
          }),
        )
        .join('\n\n'),
    );
    expect(state.ready).toBe(false);
    expect(id === SERVER ? state.server : state.mount).toHaveProperty('activeState', 'activating');
  });

  test.each([
    { loadState: 'loaded', activeState: 'failed', subState: 'failed' },
    { loadState: 'not-found', activeState: 'inactive', subState: 'dead' },
    { loadState: 'loaded', activeState: 'deactivating', subState: 'stop-sigterm' },
    { loadState: 'loaded', activeState: 'active', subState: 'exited' },
  ])('preserves non-serving states for later reconciliation: %j', async (server) => {
    const state = await observation(`${unit({ id: SERVER, ...server })}\n\n${unit({ id: MOUNT })}`);
    expect(state.server).toEqual(server);
    expect(state.ready).toBe(false);
  });

  test.each([
    '',
    unit({ id: SERVER }),
    `${unit({ id: SERVER })}\n\n${unit({ id: SERVER })}`,
    `${unit({ id: SERVER })}\n\n${unit({ id: 'nibrun-app-zerofs-mount@app-2.service' })}`,
    `${unit({ id: SERVER })}\n\nId=${MOUNT}\nLoadState=loaded\nActiveState=active`,
    `${unit({ id: SERVER })}\n\n${unit({ id: MOUNT })}\n\n${unit({ id: 'unexpected.service' })}`,
  ])('rejects incomplete or ambiguous output instead of guessing: %#', async (output) => {
    const commands = recordingCommands(() => succeeding({ stdout: output }));
    const result = await provided(commands.layer)(Effect.either(observeAppZerofs(APP_ID)));
    expect(Either.isLeft(result) && result.left._tag).toBe('AppZerofsObservationError');
  });

  test('a failed query does not expose output or turn a partial result into readiness', async () => {
    const commands = recordingCommands(() =>
      succeeding({ code: 1, stdout: 'customer-access-key', stderr: 'customer-secret-key' }),
    );
    const result = await provided(commands.layer)(Effect.either(observeAppZerofs(APP_ID)));
    expect(Either.isLeft(result) && result.left._tag).toBe('AppZerofsObservationError');
    expect(JSON.stringify(result)).not.toContain('customer-access-key');
    expect(JSON.stringify(result)).not.toContain('customer-secret-key');
    expect(commands.executables()).toEqual(['systemctl']);
  });

  test('a timed-out query is an observation failure and starts no recovery action', async () => {
    const commands = recordingCommands((request) =>
      Effect.fail(new CommandTimedOut({ command: request.command })),
    );
    const result = await provided(commands.layer)(Effect.either(observeAppZerofs(APP_ID)));
    expect(Either.isLeft(result) && result.left._tag).toBe('AppZerofsObservationError');
    expect(commands.commands.map(({ command }) => command)).toEqual([
      ['systemctl', 'show', SERVER, MOUNT, '--property=Id,LoadState,ActiveState,SubState'],
    ]);
  });
});
