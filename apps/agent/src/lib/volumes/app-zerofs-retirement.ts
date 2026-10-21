import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { FileSystem } from '@effect/platform';
import { type AppId, AppIdSchema, VolumeIdSchema } from '@repo/protocol';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { Data, Effect, Option } from 'effect';
import { readJsonFile, writeJsonFile } from '#lib/json-store.ts';
import { AgentConfig } from '#services/agent-config.service.ts';

const RetirementSchema = Type.Object({
  appId: AppIdSchema,
  volumeId: VolumeIdSchema,
  configDigest: Type.String({ pattern: '^[a-f0-9]{64}$' }),
});

export type AppZerofsRetirement = typeof RetirementSchema.static;

export class AppZerofsRetirementUnavailable extends Data.TaggedError(
  'AppZerofsRetirementUnavailable',
) {
  override get message() {
    return 'The app filesystem retirement could not be verified.';
  }
}

export function appZerofsRetirementDirectory(stateDir: string) {
  return join(stateDir, 'zerofs-retired');
}

export function appZerofsRetirementPath({ stateDir, appId }: { stateDir: string; appId: AppId }) {
  return join(appZerofsRetirementDirectory(stateDir), `${appId}.json`);
}

export function appZerofsConfigDigest(contents: string) {
  return createHash('sha256').update(contents).digest('hex');
}

export function readAppZerofsRetirement(appId: AppId) {
  return Effect.gen(function* () {
    const config = yield* AgentConfig;
    const value = yield* readJsonFile(
      appZerofsRetirementPath({ stateDir: config.stateDir, appId }),
    );
    if (Option.isNone(value)) {
      return Option.none<AppZerofsRetirement>();
    }
    if (!Value.Check(RetirementSchema, value.value) || value.value.appId !== appId) {
      return yield* new AppZerofsRetirementUnavailable();
    }
    return Option.some(value.value);
  }).pipe(Effect.mapError(() => new AppZerofsRetirementUnavailable()));
}

export function syncAppZerofsRetirement(appId: AppId) {
  return Effect.scoped(
    Effect.gen(function* () {
      const config = yield* AgentConfig;
      const fs = yield* FileSystem.FileSystem;
      for (const path of [
        appZerofsRetirementPath({ stateDir: config.stateDir, appId }),
        appZerofsRetirementDirectory(config.stateDir),
        config.stateDir,
      ]) {
        yield* (yield* fs.open(path, { flag: 'r' })).sync;
      }
    }),
  ).pipe(Effect.mapError(() => new AppZerofsRetirementUnavailable()));
}

/** Publish only after the image deletion is durable and both app services have stopped. */
export function writeAppZerofsRetirement(retirement: AppZerofsRetirement) {
  return Effect.gen(function* () {
    const config = yield* AgentConfig;
    yield* writeJsonFile({
      path: appZerofsRetirementPath({ stateDir: config.stateDir, appId: retirement.appId }),
      value: retirement,
    });
    // A crash must not allow cached desired state to reopen a writer already reported deleted.
    yield* syncAppZerofsRetirement(retirement.appId);
  }).pipe(Effect.mapError(() => new AppZerofsRetirementUnavailable()));
}
