import { describe, expect, test } from 'bun:test';
import { FileSystem, Path } from '@effect/platform';
import { Effect, Option } from 'effect';
import { writeJsonFile } from '#lib/json-store.ts';
import {
  adoptedGuestImage,
  BOOTED_IMAGE_FILENAME,
  readBootedGuestImage,
} from '#lib/vm/guest-image.ts';
import { DEPLOYMENT_ID } from '#tests/support/fixtures.ts';
import { installedGuestImage } from '#tests/support/guest-image.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';

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

  test('booted identity survives a change to the adopted image', () =>
    run(
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const host = yield* installedGuestImage(OLD_VERSION);
        const workingDir = yield* temporaryDirectory;
        const booted = { ...host.image, deploymentId: DEPLOYMENT_ID };
        yield* writeJsonFile({ path: path.join(workingDir, BOOTED_IMAGE_FILENAME), value: booted });
        yield* host.activate(NEW_VERSION);
        expect(yield* readBootedGuestImage(workingDir)).toEqual(Option.some(booted));
      }),
    ));

  test('missing and malformed legacy boot records remain unknown', () =>
    run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const workingDir = yield* temporaryDirectory;
        expect(yield* readBootedGuestImage(workingDir)).toEqual(Option.none());
        yield* fs.writeFileString(path.join(workingDir, BOOTED_IMAGE_FILENAME), '{');
        expect(yield* readBootedGuestImage(workingDir)).toEqual(Option.none());
        yield* writeJsonFile({
          path: path.join(workingDir, BOOTED_IMAGE_FILENAME),
          value: {
            version: OLD_VERSION,
            deploymentId: DEPLOYMENT_ID,
            kernelPath: '/images/current/vmlinux',
            rootfsPath: '/images/current/rootfs.ext4',
          },
        });
        expect(yield* readBootedGuestImage(workingDir)).toEqual(Option.none());
      }),
    ));
});
