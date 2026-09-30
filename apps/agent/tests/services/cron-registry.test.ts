import { describe, expect, test } from 'bun:test';
import { FileSystem, type Path } from '@effect/platform';
import { SystemError } from '@effect/platform/Error';
import {
  AppIdSchema,
  type CronJobDefinition,
  DeploymentIdSchema,
  MAX_CRON_JOBS_PER_APP,
  Value,
} from '@repo/protocol';
import { Deferred, Effect, Either, Exit, Fiber, Layer, Option, Ref } from 'effect';
import { readJsonFile, writeJsonFile } from '#lib/json-store.ts';
import { CronRegistry } from '#services/cron-registry.service.ts';
import { agentConfig } from '#tests/support/config.ts';
import { APP_ID, DEPLOYMENT_ID } from '#tests/support/fixtures.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';

const DEPLOYMENT = { appId: APP_ID, deploymentId: DEPLOYMENT_ID };
const NEXT_DEPLOYMENT = { ...DEPLOYMENT, deploymentId: Value.Parse(DeploymentIdSchema, 'dep-2') };
const OTHER_APP = { appId: Value.Parse(AppIdSchema, 'app-2'), deploymentId: DEPLOYMENT_ID };
const JOB: CronJobDefinition = { schedule: '@hourly', command: '/mnt/artifact/server cleanup' };

function registryAt(path: string) {
  return CronRegistry.DefaultWithoutDependencies.pipe(
    Layer.provide(agentConfig({ cronRegistryFile: path })),
  );
}

function withRegistry<A, E>(
  effect: Effect.Effect<A, E, CronRegistry | FileSystem.FileSystem | Path.Path>,
) {
  return provided(platform)(
    Effect.gen(function* () {
      const directory = yield* temporaryDirectory;
      return yield* effect.pipe(Effect.provide(registryAt(`${directory}/crons.json`)));
    }),
  );
}

describe('durable cron registrations', () => {
  test('a new deployment starts empty and replacement preserves order and duplicate jobs', async () => {
    await withRegistry(
      Effect.gen(function* () {
        const registry = yield* CronRegistry;
        expect(Option.isNone(yield* registry.get({ appId: APP_ID }))).toBe(true);
        yield* registry.beginDeployment(DEPLOYMENT);
        const jobs = [JOB, { ...JOB, schedule: '@daily' }, JOB];
        yield* registry.replace({ ...DEPLOYMENT, jobs });
        expect(Option.getOrThrow(yield* registry.get({ appId: APP_ID }))).toEqual({
          ...DEPLOYMENT,
          jobs,
        });
      }),
    );
  });

  test.each([
    { name: 'invalid syntax', jobs: [{ ...JOB, schedule: '@reboot' }], tag: 'InvalidCronSchedule' },
    {
      name: 'no future occurrence',
      jobs: [{ ...JOB, schedule: '0 0 30 2 *' }],
      tag: 'InvalidCronSchedule',
    },
    { name: 'missing command', jobs: [{ schedule: JOB.schedule }], tag: 'ProtocolMismatch' },
    {
      name: 'eleven jobs',
      jobs: Array.from({ length: MAX_CRON_JOBS_PER_APP + 1 }, () => JOB),
      tag: 'ProtocolMismatch',
    },
  ] as const)('$name leaves the previous table intact', async ({ jobs, tag }) => {
    await withRegistry(
      Effect.gen(function* () {
        const registry = yield* CronRegistry;
        yield* registry.beginDeployment(DEPLOYMENT);
        yield* registry.replace({ ...DEPLOYMENT, jobs: [JOB] });
        const result = yield* Effect.either(registry.replace({ ...DEPLOYMENT, jobs }));
        expect(Either.isLeft(result) && result.left._tag).toBe(tag);
        expect(Option.getOrThrow(yield* registry.get({ appId: APP_ID })).jobs).toEqual([JOB]);
      }),
    );
  });

  test('a table of ten jobs fits; an empty replacement removes the jobs', async () => {
    await withRegistry(
      Effect.gen(function* () {
        const registry = yield* CronRegistry;
        yield* registry.beginDeployment(DEPLOYMENT);
        yield* registry.replace({
          ...DEPLOYMENT,
          jobs: Array.from({ length: MAX_CRON_JOBS_PER_APP }, () => JOB),
        });
        expect(Option.getOrThrow(yield* registry.get({ appId: APP_ID })).jobs).toHaveLength(
          MAX_CRON_JOBS_PER_APP,
        );
        yield* registry.replace({ ...DEPLOYMENT, jobs: [] });
        expect(Option.getOrThrow(yield* registry.get({ appId: APP_ID }))).toEqual({
          ...DEPLOYMENT,
          jobs: [],
        });
      }),
    );
  });

  test('reobserving the same deployment retains its jobs; a new deployment clears them', async () => {
    await withRegistry(
      Effect.gen(function* () {
        const registry = yield* CronRegistry;
        yield* registry.beginDeployment(DEPLOYMENT);
        yield* registry.replace({ ...DEPLOYMENT, jobs: [JOB] });
        yield* registry.beginDeployment(DEPLOYMENT);
        expect(Option.getOrThrow(yield* registry.get({ appId: APP_ID })).jobs).toEqual([JOB]);
        yield* registry.beginDeployment(NEXT_DEPLOYMENT);
        expect(Option.getOrThrow(yield* registry.get({ appId: APP_ID }))).toEqual({
          ...NEXT_DEPLOYMENT,
          jobs: [],
        });
        const stale = yield* Effect.either(registry.replace({ ...DEPLOYMENT, jobs: [JOB] }));
        expect(Either.isLeft(stale) && stale.left._tag).toBe('CronDeploymentMismatch');
        const staleRemoval = yield* Effect.either(registry.remove(DEPLOYMENT));
        expect(Either.isLeft(staleRemoval) && staleRemoval.left._tag).toBe(
          'CronDeploymentMismatch',
        );
      }),
    );
  });

  test('an unregistered or removed app cannot register jobs', async () => {
    await withRegistry(
      Effect.gen(function* () {
        const registry = yield* CronRegistry;
        const first = yield* Effect.either(registry.replace({ ...DEPLOYMENT, jobs: [JOB] }));
        expect(Either.isLeft(first) && first.left._tag).toBe('CronDeploymentMismatch');
        yield* registry.beginDeployment(DEPLOYMENT);
        yield* registry.remove(DEPLOYMENT);
        yield* registry.remove(DEPLOYMENT);
        const removed = yield* Effect.either(registry.replace({ ...DEPLOYMENT, jobs: [JOB] }));
        expect(Either.isLeft(removed) && removed.left._tag).toBe('CronDeploymentMismatch');
        expect(Option.isNone(yield* registry.get({ appId: APP_ID }))).toBe(true);
      }),
    );
  });

  test('callers cannot mutate stored jobs through input or returned tables', async () => {
    await withRegistry(
      Effect.gen(function* () {
        const registry = yield* CronRegistry;
        yield* registry.beginDeployment(DEPLOYMENT);
        const jobs = [{ ...JOB }];
        yield* registry.replace({ ...DEPLOYMENT, jobs });
        jobs[0]!.command = 'changed input';
        const table = Option.getOrThrow(yield* registry.get({ appId: APP_ID }));
        table.jobs[0]!.command = 'changed output';
        table.jobs.push(JOB);
        expect(Option.getOrThrow(yield* registry.get({ appId: APP_ID })).jobs).toEqual([JOB]);
      }),
    );
  });

  test('concurrent replacements survive a fresh registry and a deployment reset remains authoritative', async () => {
    await provided(platform)(
      Effect.gen(function* () {
        const directory = yield* temporaryDirectory;
        const path = `${directory}/crons.json`;
        yield* Effect.gen(function* () {
          const registry = yield* CronRegistry;
          yield* Effect.forEach(
            [DEPLOYMENT, OTHER_APP],
            (deployment) => registry.beginDeployment(deployment),
            { concurrency: 'unbounded' },
          );
          yield* Effect.forEach(
            [DEPLOYMENT, OTHER_APP],
            (deployment) => registry.replace({ ...deployment, jobs: [JOB] }),
            { concurrency: 'unbounded' },
          );
        }).pipe(Effect.provide(registryAt(path)));
        yield* Effect.gen(function* () {
          const registry = yield* CronRegistry;
          for (const deployment of [DEPLOYMENT, OTHER_APP]) {
            expect(Option.getOrThrow(yield* registry.get({ appId: deployment.appId }))).toEqual({
              ...deployment,
              jobs: [JOB],
            });
          }
          yield* registry.beginDeployment(NEXT_DEPLOYMENT);
        }).pipe(Effect.provide(registryAt(path)));
        yield* Effect.gen(function* () {
          const registry = yield* CronRegistry;
          expect(Option.getOrThrow(yield* registry.get({ appId: APP_ID }))).toEqual({
            ...NEXT_DEPLOYMENT,
            jobs: [],
          });
          const stale = yield* Effect.either(registry.replace({ ...DEPLOYMENT, jobs: [JOB] }));
          expect(Either.isLeft(stale) && stale.left._tag).toBe('CronDeploymentMismatch');
          yield* registry.remove(NEXT_DEPLOYMENT);
        }).pipe(Effect.provide(registryAt(path)));
        yield* Effect.gen(function* () {
          const registry = yield* CronRegistry;
          expect(Option.isNone(yield* registry.get({ appId: APP_ID }))).toBe(true);
          expect(Option.getOrThrow(yield* registry.get({ appId: OTHER_APP.appId })).jobs).toEqual([
            JOB,
          ]);
        }).pipe(Effect.provide(registryAt(path)));
      }),
    );
  });

  test('failed writes preserve both memory and the previously acknowledged file', async () => {
    await provided(platform)(
      Effect.gen(function* () {
        const directory = yield* temporaryDirectory;
        const path = `${directory}/crons.json`;
        const fs = yield* FileSystem.FileSystem;
        const failWrites = yield* Ref.make(false);
        const failingFs = {
          ...fs,
          rename: (...args: Parameters<typeof fs.rename>) =>
            Ref.get(failWrites).pipe(
              Effect.flatMap((fail) =>
                fail
                  ? Effect.fail(
                      new SystemError({
                        reason: 'PermissionDenied',
                        module: 'FileSystem',
                        method: 'rename',
                      }),
                    )
                  : fs.rename(...args),
              ),
            ),
        };
        yield* Effect.gen(function* () {
          const registry = yield* CronRegistry;
          yield* registry.beginDeployment(DEPLOYMENT);
          yield* registry.replace({ ...DEPLOYMENT, jobs: [JOB] });
          yield* Ref.set(failWrites, true);
          for (const change of [
            registry.replace({ ...DEPLOYMENT, jobs: [] }),
            registry.beginDeployment(NEXT_DEPLOYMENT),
            registry.remove(DEPLOYMENT),
          ]) {
            const result = yield* Effect.either(change);
            expect(Either.isLeft(result) && result.left._tag).toBe('CronRegistryError');
            expect(Option.getOrThrow(yield* registry.get({ appId: APP_ID }))).toEqual({
              ...DEPLOYMENT,
              jobs: [JOB],
            });
            expect(Option.getOrThrow(yield* readJsonFile(path))).toEqual([
              { ...DEPLOYMENT, jobs: [JOB] },
            ]);
          }
        }).pipe(
          Effect.provide(registryAt(path)),
          Effect.provideService(FileSystem.FileSystem, failingFs),
        );
      }),
    );
  });

  test('acknowledgment waits for the rename and interruption cannot separate disk from memory', async () => {
    await provided(platform)(
      Effect.gen(function* () {
        const directory = yield* temporaryDirectory;
        const path = `${directory}/crons.json`;
        const fs = yield* FileSystem.FileSystem;
        const holdWrites = yield* Ref.make(false);
        const renamed = yield* Deferred.make<void>();
        const released = yield* Deferred.make<void>();
        const heldFs = {
          ...fs,
          rename: (...args: Parameters<typeof fs.rename>) =>
            fs.rename(...args).pipe(
              Effect.andThen(Ref.get(holdWrites)),
              Effect.flatMap((hold) =>
                hold
                  ? Deferred.succeed(renamed, undefined).pipe(
                      Effect.andThen(Deferred.await(released)),
                    )
                  : Effect.void,
              ),
            ),
        };
        yield* Effect.gen(function* () {
          const registry = yield* CronRegistry;
          yield* registry.beginDeployment(DEPLOYMENT);
          yield* registry.replace({ ...DEPLOYMENT, jobs: [JOB] });
          yield* Ref.set(holdWrites, true);
          const writer = yield* Effect.fork(registry.replace({ ...DEPLOYMENT, jobs: [] }));
          yield* Deferred.await(renamed);
          expect(Option.isNone(yield* Fiber.poll(writer))).toBe(true);
          expect(Option.getOrThrow(yield* registry.get({ appId: APP_ID })).jobs).toEqual([JOB]);
          expect(Option.getOrThrow(yield* readJsonFile(path))).toEqual([
            { ...DEPLOYMENT, jobs: [] },
          ]);
          yield* Fiber.interruptAsFork(writer, yield* Effect.fiberId);
          yield* Deferred.succeed(released, undefined);
          expect(Exit.isInterrupted(yield* Fiber.await(writer))).toBe(true);
          expect(Option.getOrThrow(yield* registry.get({ appId: APP_ID })).jobs).toEqual([]);
        }).pipe(
          Effect.provide(registryAt(path)),
          Effect.provideService(FileSystem.FileSystem, heldFs),
        );
      }),
    );
  });

  test('malformed JSON fails closed with a sanitized error', async () => {
    await provided(platform)(
      Effect.gen(function* () {
        const directory = yield* temporaryDirectory;
        const path = `${directory}/crons.json`;
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString(path, '{"command":"tenant-secret",');
        const result = yield* Effect.either(CronRegistry.pipe(Effect.provide(registryAt(path))));
        expect(Either.isLeft(result) && result.left._tag).toBe('CronRegistryError');
        expect(Either.isLeft(result) && JSON.stringify(result.left).includes('tenant-secret')).toBe(
          false,
        );
        expect(yield* fs.readFileString(path)).toBe('{"command":"tenant-secret",');
      }),
    );
  });

  test.each([
    { name: 'wrong shape', value: { secret: 'tenant-secret' } },
    {
      name: 'invalid stored schedule',
      value: [{ ...DEPLOYMENT, jobs: [{ ...JOB, schedule: 'tenant-secret' }] }],
    },
    {
      name: 'duplicate apps',
      value: [
        { ...DEPLOYMENT, jobs: [JOB] },
        { ...NEXT_DEPLOYMENT, jobs: [] },
      ],
    },
  ])(
    'refuses to restore $name without rewriting it or exposing tenant values',
    async ({ value }) => {
      await provided(platform)(
        Effect.gen(function* () {
          const directory = yield* temporaryDirectory;
          const path = `${directory}/crons.json`;
          yield* writeJsonFile({ path, value });
          const result = yield* Effect.either(CronRegistry.pipe(Effect.provide(registryAt(path))));
          expect(Either.isLeft(result) && result.left._tag).toBe('CronRegistryError');
          expect(
            Either.isLeft(result) && JSON.stringify(result.left).includes('tenant-secret'),
          ).toBe(false);
          expect(Option.getOrThrow(yield* readJsonFile(path))).toEqual(value);
        }),
      );
    },
  );
});
