import { expect, test } from 'bun:test';
import { dirname, join } from 'node:path';
import { FileSystem } from '@effect/platform';
import { type AppId, AppIdSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Effect, Layer } from 'effect';
import {
  appVmUnitFile,
  isolateAppVmStorage,
  VM_TEMPLATE_UNIT_FILE,
} from '#lib/vm/app-storage-unit.ts';
import { vmUnitName } from '#lib/vm/systemd.ts';
import { appZerofsUnits } from '#lib/volumes/app-zerofs-systemd.ts';
import { CommandRunner, run as runCommand, stdoutOf } from '#services/command-runner.service.ts';
import { readVmUnitTemplate } from '#tests/support/app-vm-unit.ts';
import { platform, provided } from '#tests/support/run.ts';

const SERVICE_BODY = '[Service]\nType=exec\nExecStart=/bin/sleep infinity\nTimeoutStopSec=2\n';
const TEST_TIMEOUT_MS = 60_000;
const run = provided(CommandRunner.Default.pipe(Layer.provideMerge(platform)));

function pidOf(appId: AppId) {
  return stdoutOf({
    command: ['systemctl', 'show', vmUnitName(appId), '--property=MainPID', '--value'],
  }).pipe(Effect.map((value) => value.trim()));
}

function requireDisposableUnits({
  files,
  units,
}: {
  files: readonly string[];
  units: readonly string[];
}) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    for (const file of files) {
      if (yield* fs.exists(file)) {
        return yield* Effect.fail(
          new Error('VM isolation fixture refuses to replace an existing host unit.'),
        );
      }
    }
    for (const unit of units) {
      const state = yield* runCommand({
        command: ['systemctl', 'show', unit, '--property=LoadState', '--value'],
      });
      if (state.stdout.trim() !== 'not-found') {
        return yield* Effect.fail(new Error('VM isolation fixture requires unused unit names.'));
      }
    }
  });
}

test.skipIf(process.platform !== 'linux' || process.env.NIBRUN_TEST_VM_SYSTEMD !== '1')(
  'real systemd isolates configured VMs while retaining the shared VM dependency',
  async () => {
    await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const first = Value.Parse(AppIdSchema, `test-${process.pid}-a`);
        const second = Value.Parse(AppIdSchema, `test-${process.pid}-b`);
        const legacy = Value.Parse(AppIdSchema, `test-${process.pid}-shared`);
        const template = `${(yield* readVmUnitTemplate()).split('[Service]')[0]}${SERVICE_BODY}`;
        const sharedUnit = template.match(/^BindsTo=(\S+)$/m)?.[1];
        if (!sharedUnit) {
          return yield* Effect.fail(new Error('VM fixture has no shared dependency.'));
        }
        const runtimeDir = dirname(appVmUnitFile(first));
        const sharedFile = join(runtimeDir, sharedUnit);
        const appTemplate = join(runtimeDir, appZerofsUnits(first).server.replace(first, ''));
        const files = [
          VM_TEMPLATE_UNIT_FILE,
          sharedFile,
          appTemplate,
          appVmUnitFile(first),
          appVmUnitFile(second),
        ];
        const units = [
          vmUnitName(first),
          vmUnitName(second),
          vmUnitName(legacy),
          appZerofsUnits(first).server,
          appZerofsUnits(second).server,
          sharedUnit,
        ];
        yield* requireDisposableUnits({ files, units });
        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            yield* runCommand({ command: ['systemctl', 'stop', ...units] }).pipe(Effect.ignore);
            yield* Effect.forEach(files, (file) =>
              fs.remove(file, { force: true }).pipe(Effect.ignore),
            );
            yield* runCommand({ command: ['systemctl', 'daemon-reload'] }).pipe(Effect.ignore);
            yield* runCommand({ command: ['systemctl', 'reset-failed', ...units] }).pipe(
              Effect.ignore,
            );
          }),
        );
        yield* fs.makeDirectory(dirname(VM_TEMPLATE_UNIT_FILE), { recursive: true });
        yield* fs.makeDirectory(runtimeDir, { recursive: true });
        yield* fs.writeFileString(VM_TEMPLATE_UNIT_FILE, template);
        yield* fs.writeFileString(
          sharedFile,
          `[Unit]\nDescription=Shared storage fixture\n${SERVICE_BODY}`,
        );
        yield* fs.writeFileString(
          appTemplate,
          `[Unit]\nDescription=Private storage fixture\n${SERVICE_BODY}`,
        );
        yield* stdoutOf({ command: ['systemctl', 'daemon-reload'] });
        expect(
          (yield* stdoutOf({
            command: ['systemctl', 'show', vmUnitName(first), '--property=BindsTo', '--value'],
          })).trim(),
        ).toBe(sharedUnit);
        yield* isolateAppVmStorage(first);
        yield* isolateAppVmStorage(second);
        yield* stdoutOf({
          command: ['systemctl', 'start', ...[first, second, legacy].map(vmUnitName)],
        });
        const firstPid = yield* pidOf(first);
        const secondPid = yield* pidOf(second);
        expect(firstPid).not.toBe('0');
        expect(secondPid).not.toBe('0');
        expect(yield* pidOf(legacy)).not.toBe('0');
        yield* isolateAppVmStorage(first);
        expect(yield* pidOf(first)).toBe(firstPid);

        yield* stdoutOf({ command: ['systemctl', 'restart', sharedUnit] });
        expect(yield* pidOf(legacy)).toBe('0');
        expect(yield* pidOf(first)).toBe(firstPid);
        expect(yield* pidOf(second)).toBe(secondPid);

        yield* stdoutOf({ command: ['systemctl', 'restart', appZerofsUnits(first).server] });
        expect(yield* pidOf(first)).toBe('0');
        expect(yield* pidOf(second)).toBe(secondPid);
      }),
    );
  },
  TEST_TIMEOUT_MS,
);
