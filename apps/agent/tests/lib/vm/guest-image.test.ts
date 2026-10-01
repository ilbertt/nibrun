import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { writeJsonFile } from '#lib/json-store.ts';
import { adoptedGuestImage } from '#lib/vm/guest-image.ts';
import { installedGuestImage } from '#tests/support/guest-image.ts';
import { platform, provided } from '#tests/support/run.ts';

const run = provided(platform);
const OLD_VERSION = 'image-old';
const NEW_VERSION = 'image-new';

describe('immutable guest image identity', () => {
  test('resolves the adopted image into immutable boot paths', () =>
    run(
      Effect.gen(function* () {
        const host = yield* installedGuestImage(OLD_VERSION);
        const old = yield* adoptedGuestImage(host);
        expect(old).toEqual(host.image);
        const next = yield* host.activate(NEW_VERSION);
        expect(yield* adoptedGuestImage(host)).toEqual(next);
        expect(old.rootfsPath).toBe(host.image.rootfsPath);
        expect(old.kernelPath).toBe(host.image.kernelPath);
      }),
    ));

  test('refuses boot when the active symlink and adopted version disagree', () =>
    run(
      Effect.gen(function* () {
        const host = yield* installedGuestImage(OLD_VERSION);
        yield* writeJsonFile({
          path: host.versionsFile,
          value: {
            agent: 'abc1234',
            guestImage: NEW_VERSION,
            zerofs: '0.5.0',
            firecracker: '1.16.1',
          },
        });
        expect((yield* adoptedGuestImage(host).pipe(Effect.flip))._tag).toBe(
          'GuestImageUnavailable',
        );
      }),
    ));
});
