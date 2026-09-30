import { describe, expect, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import { FileSystem, type Path } from '@effect/platform';
import { DeploymentIdSchema, MAX_CRONTAB_BYTES, Value } from '@repo/protocol';
import { Effect, Layer, Option } from 'effect';
import { CronRegistrationReceiver } from '#services/cron-registration-receiver.service.ts';
import { CronRegistry } from '#services/cron-registry.service.ts';
import { agentConfig } from '#tests/support/config.ts';
import { registrationExchange, registrationFrame } from '#tests/support/cron-registration.ts';
import { APP_ID, DEPLOYMENT_ID } from '#tests/support/fixtures.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';

const SOURCE = { appId: APP_ID, deploymentId: DEPLOYMENT_ID };
const NEXT = { ...SOURCE, deploymentId: Value.Parse(DeploymentIdSchema, 'dep-next') };
const MAGIC_SPLIT_AT = 3;
const LENGTH_SPLIT_AT = 8;
const LENGTH_OFFSET = 5;

function serving<A, E>(
  effect: (fixture: {
    registry: CronRegistry;
    receiver: CronRegistrationReceiver;
    socketPath: string;
  }) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
) {
  return provided(platform)(
    Effect.gen(function* () {
      const directory = yield* temporaryDirectory;
      const socketPath = `${directory}/cron.sock`;
      return yield* Effect.gen(function* () {
        const registry = yield* CronRegistry;
        const receiver = yield* CronRegistrationReceiver;
        yield* registry.beginDeployment(SOURCE);
        yield* receiver.attach({ source: SOURCE, socketPath });
        return yield* effect({ registry, receiver, socketPath });
      }).pipe(
        Effect.provide(
          CronRegistrationReceiver.DefaultWithoutDependencies.pipe(
            Layer.provideMerge(CronRegistry.DefaultWithoutDependencies),
            Layer.provide(agentConfig({ cronRegistryFile: `${directory}/crons.json` })),
          ),
        ),
      );
    }),
  );
}

function exchange({ socketPath, code, text }: { socketPath: string; code: number; text: string }) {
  return Effect.promise(() =>
    registrationExchange({ socketPath, parts: [registrationFrame({ code, text })] }),
  );
}

describe('guest cron registrations', () => {
  test('replacement is acknowledged and listed from the persisted registry', async () => {
    await serving(({ registry, socketPath }) =>
      Effect.gen(function* () {
        const text = '# keep this\nTOKEN="secret-value"\n@hourly /mnt/artifact/server cleanup\n';
        expect(yield* exchange({ socketPath, code: 1, text })).toEqual({ status: 0, text: '' });
        expect(yield* exchange({ socketPath, code: 2, text: '' })).toEqual({ status: 0, text });
        const rejected = yield* exchange({ socketPath, code: 1, text: '@reboot secret-command' });
        expect(rejected.status).toBe(1);
        expect(rejected.text).not.toContain('secret-command');
        expect(yield* exchange({ socketPath, code: 2, text: '' })).toEqual({ status: 0, text });
        expect(Option.getOrThrow(yield* registry.get({ appId: APP_ID })).jobs).toHaveLength(1);
        expect(yield* exchange({ socketPath, code: 1, text: '' })).toEqual({ status: 0, text: '' });
        expect(Option.getOrThrow(yield* registry.get({ appId: APP_ID })).jobs).toEqual([]);
      }),
    );
  });

  test('a fragmented request is assembled once', async () => {
    await serving(({ registry, socketPath }) =>
      Effect.gen(function* () {
        const frame = registrationFrame({ code: 1, text: '@hourly command' });
        const result = yield* Effect.promise(() =>
          registrationExchange({
            socketPath,
            parts: [
              frame.subarray(0, MAGIC_SPLIT_AT),
              frame.subarray(MAGIC_SPLIT_AT, LENGTH_SPLIT_AT),
              frame.subarray(LENGTH_SPLIT_AT),
            ],
          }),
        );
        expect(result.status).toBe(0);
        expect(Option.getOrThrow(yield* registry.get({ appId: APP_ID })).jobs).toHaveLength(1);
      }),
    );
  });

  test('an old attachment cannot read or overwrite a new deployment', async () => {
    await serving(({ registry, receiver, socketPath }) =>
      Effect.gen(function* () {
        yield* registry.beginDeployment(NEXT);
        expect((yield* exchange({ socketPath, code: 1, text: '@hourly old-command' })).status).toBe(
          1,
        );
        expect((yield* exchange({ socketPath, code: 2, text: '' })).status).toBe(1);
        expect(Option.getOrThrow(yield* registry.get({ appId: APP_ID })).jobs).toEqual([]);
        yield* receiver.attach({ source: NEXT, socketPath });
        expect((yield* exchange({ socketPath, code: 1, text: '@daily new-command' })).status).toBe(
          0,
        );
        yield* receiver.detach(APP_ID);
        const fs = yield* FileSystem.FileSystem;
        expect(yield* fs.exists(socketPath)).toBe(false);
      }),
    );
  });

  test.each([
    Buffer.from('XXXX\x01\0\0\0\0'),
    registrationFrame({ code: 255, text: '' }),
    registrationFrame({ code: 2, text: 'unexpected' }),
    Buffer.concat([registrationFrame({ code: 1, text: '' }), Buffer.from('extra')]),
    Buffer.from('NBC1\x01\0\0\0\x01\xff', 'latin1'),
    (() => {
      const header = registrationFrame({ code: 1, text: '' });
      header.writeUInt32BE(MAX_CRONTAB_BYTES + 1, LENGTH_OFFSET);
      return header;
    })(),
  ])('rejects malformed input before touching the table', async (frame) => {
    await serving(({ registry, socketPath }) =>
      Effect.gen(function* () {
        expect(
          (yield* Effect.promise(() => registrationExchange({ socketPath, parts: [frame] })))
            .status,
        ).toBe(1);
        expect(Option.getOrThrow(yield* registry.get({ appId: APP_ID })).jobs).toEqual([]);
      }),
    );
  });
});
