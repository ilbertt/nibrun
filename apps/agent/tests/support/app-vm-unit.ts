import { FileSystem } from '@effect/platform';
import { SystemError } from '@effect/platform/Error';
import { Effect, Layer } from 'effect';
import { appVmUnitFile, VM_TEMPLATE_UNIT_FILE } from '#lib/vm/app-storage-unit.ts';
import { vmUnitName } from '#lib/vm/systemd.ts';
import { appZerofsUnits } from '#lib/volumes/app-zerofs-systemd.ts';
import { recordingCommands, succeeding } from '#tests/support/commands.ts';
import { APP_ID } from '#tests/support/fixtures.ts';

export function readVmUnitTemplate() {
  return Effect.promise(() =>
    Bun.file(
      new URL('../../../../infra/app-host/systemd/nibrun-vm@.service', import.meta.url),
    ).text(),
  );
}

export function appVmUnitHost() {
  return Effect.gen(function* () {
    const template = yield* readVmUnitTemplate();
    const unitFile = appVmUnitFile(APP_ID);
    const files = new Map<string, string>([[VM_TEMPLATE_UNIT_FILE, template]]);
    const state = {
      loaded: false,
      failReload: false,
      wrongDependency: false,
      wrongFragment: false,
      readOnly: false,
    };
    const commands = recordingCommands(({ command }) => {
      if (command[1] === 'daemon-reload') {
        state.loaded = !state.failReload;
        return succeeding({ code: state.failReload ? 1 : 0, stderr: 'private-unit-details' });
      }
      const dependency =
        state.loaded && !state.wrongDependency
          ? appZerofsUnits(APP_ID).server
          : 'nibrun-zerofs.service';
      return succeeding({
        stdout: [
          `Id=${vmUnitName(APP_ID)}`,
          'LoadState=loaded',
          `FragmentPath=${state.loaded && !state.wrongFragment ? unitFile : VM_TEMPLATE_UNIT_FILE}`,
          `BindsTo=${dependency}`,
          `After=basic.target ${dependency}`,
          'Requires=sysinit.target',
          'Wants=',
          'Requisite=',
          'PartOf=',
        ].join('\n'),
      });
    });
    function failure(method: string) {
      return new SystemError({
        module: 'FileSystem',
        method,
        reason: 'PermissionDenied',
        description: 'private-unit-details',
      });
    }
    const filesystem = FileSystem.layerNoop({
      exists: (path) => Effect.succeed(files.has(path)),
      readFileString: (path) =>
        files.has(path)
          ? Effect.succeed(files.get(path) ?? '')
          : Effect.fail(
              new SystemError({
                module: 'FileSystem',
                method: 'readFileString',
                reason: 'NotFound',
              }),
            ),
      makeDirectory: () => Effect.void,
      writeFileString: (...args) =>
        state.readOnly
          ? Effect.fail(failure('writeFileString'))
          : Effect.sync(() => {
              files.set(args[0], args[1]);
            }),
      rename: (...args) =>
        Effect.sync(() => {
          files.set(args[1], files.get(args[0]) ?? '');
          files.delete(args[0]);
        }),
    });
    return {
      template,
      unitFile,
      files,
      state,
      commands,
      layer: Layer.merge(filesystem, commands.layer),
    };
  });
}
