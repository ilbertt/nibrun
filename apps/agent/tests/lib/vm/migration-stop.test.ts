import { expect, test } from 'bun:test';
import { Deferred, Effect, Exit, Fiber } from 'effect';
import { stopVmForVolumeMigration } from '#lib/vm/migration-stop.ts';
import { vmApiSocketPath, vmUnitName } from '#lib/vm/systemd.ts';
import { recordingCommands, succeeding } from '#tests/support/commands.ts';
import { servingFirecracker } from '#tests/support/firecracker.ts';
import { APP_ID } from '#tests/support/fixtures.ts';
import { fakeGuest } from '#tests/support/guest.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';

const FAILURES = [
  'missing-guest',
  'freeze-refused',
  'freeze-lost',
  'pause-refused',
  'stop-refused',
  'still-running',
  'pid-survived',
  'show-refused',
] as const;
type Scenario = (typeof FAILURES)[number] | 'running' | 'stopped' | 'interrupt';
const RUNNING =
  'LoadState=loaded\nActiveState=active\nSubState=running\nMainPID=123\nControlPID=0\n';
const STOPPED = 'LoadState=loaded\nActiveState=inactive\nSubState=dead\nMainPID=0\nControlPID=0\n';
const run = provided(platform);

function observedState({ scenario, stopped }: { scenario: Scenario; stopped: boolean }) {
  if (scenario === 'stopped') {
    return STOPPED;
  }
  if (!stopped || scenario === 'still-running') {
    return RUNNING;
  }
  return scenario === 'pid-survived' ? STOPPED.replace('MainPID=0', 'MainPID=123') : STOPPED;
}

function stopResult(scenario: Scenario) {
  return scenario === 'interrupt'
    ? Effect.never
    : succeeding({ code: scenario === 'stop-refused' ? 1 : 0 });
}

function migrationHost(scenario: Scenario) {
  return Effect.gen(function* () {
    const vmDir = yield* temporaryDirectory;
    const runtimeDir = yield* temporaryDirectory;
    const guest =
      scenario === 'missing-guest' || scenario === 'stopped'
        ? undefined
        : yield* fakeGuest({
            vmDir,
            appId: APP_ID,
            behaviour: {
              onFreeze: scenario === 'freeze-refused' ? 'ERR private guest details\n' : 'OK\n',
              hangUpAfterFreezing: scenario === 'freeze-lost',
            },
          });
    const api = yield* servingFirecracker({
      socketPath: vmApiSocketPath({ runtimeDir, appId: APP_ID }),
      configuration: {},
      fault: scenario === 'pause-refused' ? 'private VMM details' : undefined,
    });
    const stopping = yield* Deferred.make<void>();
    let stopped = false;
    const commands = recordingCommands(({ command }) => {
      expect(command[2]).toBe(vmUnitName(APP_ID));
      if (command[1] === 'show') {
        return succeeding({
          code: scenario === 'show-refused' ? 1 : 0,
          stdout: observedState({ scenario, stopped }),
        });
      }
      expect(command[1]).toBe('stop');
      if (scenario !== 'stopped') {
        expect(guest?.isFrozen()).toBe(true);
        expect(api.at(-1)?.body).toEqual({ state: 'Paused' });
      }
      stopped = true;
      return Deferred.succeed(stopping, undefined).pipe(Effect.andThen(stopResult(scenario)));
    });
    return {
      api,
      commands: commands.commands,
      stopping,
      thawed:
        guest && scenario !== 'show-refused' ? Effect.promise(() => guest.thawed) : Effect.void,
      stop: stopVmForVolumeMigration({ appId: APP_ID, vmDir, runtimeDir }).pipe(
        Effect.provide(commands.layer),
      ),
    };
  });
}

test('migration stops a frozen, paused VM and confirms no process remains', () =>
  run(
    Effect.gen(function* () {
      const host = yield* migrationHost('running');
      yield* host.stop;
      yield* host.thawed;
      expect(host.commands.map(({ command }) => command[1])).toEqual(['show', 'stop', 'show']);
      expect(host.api.map((call) => call.body)).toEqual([{ state: 'Paused' }]);
    }),
  ));

test('a stopped source needs no guest freeze or VMM API', () =>
  run(
    Effect.gen(function* () {
      const host = yield* migrationHost('stopped');
      yield* host.stop;
      expect(host.api).toEqual([]);
      expect(host.commands.map(({ command }) => command[1])).toEqual(['show', 'stop', 'show']);
    }),
  ));

test.each(FAILURES)('migration refuses %s and releases its freeze', (scenario) =>
  run(
    Effect.gen(function* () {
      const host = yield* migrationHost(scenario);
      const result = yield* Effect.either(host.stop);
      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left._tag).toBe('VolumeMigrationSourceStopFailed');
        expect(result.left.message).not.toContain('private');
      }
      yield* host.thawed;
      if (
        ['stop-refused', 'still-running', 'pid-survived', 'pause-refused', 'freeze-lost'].includes(
          scenario,
        )
      ) {
        expect(host.api.at(-1)?.body).toEqual({ state: 'Resumed' });
      }
      if (
        [
          'missing-guest',
          'freeze-refused',
          'pause-refused',
          'freeze-lost',
          'show-refused',
        ].includes(scenario)
      ) {
        expect(host.commands.some(({ command }) => command[1] === 'stop')).toBe(false);
      }
    }),
  ),
);

test('interruption attempts to resume the paused VM and releases its freeze', () =>
  run(
    Effect.gen(function* () {
      const host = yield* migrationHost('interrupt');
      const stopping = yield* Effect.forkScoped(host.stop);
      yield* Deferred.await(host.stopping);
      expect(Exit.isInterrupted(yield* Fiber.interrupt(stopping))).toBe(true);
      yield* host.thawed;
      expect(host.api.at(-1)?.body).toEqual({ state: 'Resumed' });
    }),
  ));
