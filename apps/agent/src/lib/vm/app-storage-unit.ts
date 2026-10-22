import { join } from 'node:path';
import { FileSystem } from '@effect/platform';
import type { AppId } from '@repo/protocol';
import { Data, Effect, Option } from 'effect';
import { readTextFile, writeTextFile } from '#lib/json-store.ts';
import { parseProperties } from '#lib/systemd-properties.ts';
import { VM_UNIT_TEMPLATE, vmUnitName } from '#lib/vm/systemd.ts';
import { appZerofsUnits } from '#lib/volumes/app-zerofs-systemd.ts';
import { stdoutOf } from '#services/command-runner.service.ts';

export const VM_TEMPLATE_UNIT_FILE = `/etc/systemd/system/${VM_UNIT_TEMPLATE}.service`;
const RUNTIME_UNIT_DIRECTORY = '/run/systemd/system';
const UNIT_FILE_MODE = 0o644;
const DEPENDENCY_PROPERTIES = ['BindsTo', 'After', 'Requires', 'Wants', 'Requisite', 'PartOf'];
const SHOWN_PROPERTIES = ['Id', 'LoadState', 'FragmentPath', ...DEPENDENCY_PROPERTIES];

export class VmStorageUnitUnavailable extends Data.TaggedError('VmStorageUnitUnavailable') {
  override get message() {
    return 'The VM could not be isolated to its configured storage service.';
  }
}

export function appVmUnitFile(appId: AppId) {
  return join(RUNTIME_UNIT_DIRECTORY, vmUnitName(appId));
}

function appVmDefinition({ template, appId }: { template: string; appId: AppId }) {
  return Effect.gen(function* () {
    const binding = /^BindsTo=(\S+)$/gm;
    const ordering = /^After=(\S+)$/gm;
    const bindings = [...template.matchAll(binding)];
    const orderings = [...template.matchAll(ordering)];
    const sharedUnit = bindings[0]?.[1];
    if (
      bindings.length !== 1 ||
      orderings.length !== 1 ||
      !sharedUnit ||
      sharedUnit !== orderings[0]?.[1]
    ) {
      return yield* new VmStorageUnitUnavailable();
    }
    const server = appZerofsUnits(appId).server;
    return {
      sharedUnit,
      // Dependency lists cannot be cleared by drop-ins; preserve the installed service body.
      contents: template.replace(binding, `BindsTo=${server}`).replace(ordering, `After=${server}`),
    };
  });
}

function unitIsIsolated({ appId, sharedUnit }: { appId: AppId; sharedUnit: string }) {
  return Effect.gen(function* () {
    const output = yield* stdoutOf({
      command: ['systemctl', 'show', vmUnitName(appId), `--property=${SHOWN_PROPERTIES.join(',')}`],
    });
    const properties = parseProperties(output);
    const server = appZerofsUnits(appId).server;
    return (
      properties.Id === vmUnitName(appId) &&
      properties.LoadState === 'loaded' &&
      properties.FragmentPath === appVmUnitFile(appId) &&
      properties.BindsTo === server &&
      properties.After?.split(/\s+/).includes(server) === true &&
      DEPENDENCY_PROPERTIES.every(
        (property) => !properties[property]?.split(/\s+/).includes(sharedUnit),
      )
    );
  }).pipe(Effect.orElseSucceed(() => false));
}

/** Call only after verifying the app's configured filesystem and NBD attachment. */
export function isolateAppVmStorage(appId: AppId) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const definition = yield* appVmDefinition({
      appId,
      template: yield* fs.readFileString(VM_TEMPLATE_UNIT_FILE),
    });
    const path = appVmUnitFile(appId);
    const existing = yield* readTextFile(path);
    if (Option.isSome(existing) && existing.value === definition.contents.trim()) {
      if (yield* unitIsIsolated({ appId, sharedUnit: definition.sharedUnit })) {
        return;
      }
    } else {
      yield* writeTextFile({ path, value: definition.contents, mode: UNIT_FILE_MODE });
    }
    yield* stdoutOf({ command: ['systemctl', 'daemon-reload'] });
    if (!(yield* unitIsIsolated({ appId, sharedUnit: definition.sharedUnit }))) {
      return yield* new VmStorageUnitUnavailable();
    }
  }).pipe(Effect.mapError(() => new VmStorageUnitUnavailable()));
}
