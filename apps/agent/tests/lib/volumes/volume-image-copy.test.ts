import { expect, test } from 'bun:test';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { FileSystem } from '@effect/platform';
import { Effect, Exit, Fiber, Schedule } from 'effect';
import { copyImageBytes, verifyImageBytes } from '#lib/volumes/volume-image-copy.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';

const run = provided(platform);
const IMAGE_BYTES = 2_097_664;
const SMALLER_IMAGE_BYTES = 1_048_576;
const INTERRUPTED_IMAGE_BYTES = 67_108_864;
const PATTERN_PERIOD = 251;
const SOURCE_MARKER = 'source stays unchanged';

function imageHandle({ path, flag }: { path: string; flag: 'r' | 'wx' }) {
  return Effect.acquireRelease(
    Effect.promise(() => open(path, flag)),
    (handle) => Effect.promise(() => handle.close()),
  );
}

function imageFixture() {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* temporaryDirectory;
    const sourcePath = join(directory, 'source');
    const destinationPath = join(directory, 'destination');
    const payload = new Uint8Array(IMAGE_BYTES);
    for (let index = 0; index < payload.length; index++) {
      payload[index] = index % PATTERN_PERIOD;
    }
    yield* fs.writeFile(sourcePath, payload);
    const source = yield* imageHandle({ path: sourcePath, flag: 'r' });
    const destination = yield* imageHandle({ path: destinationPath, flag: 'wx' });
    return { source, destination, sourcePath, destinationPath, payload };
  });
}

test('copies an image across multiple buffers, verifies a fresh reader and preserves the source', async () => {
  await run(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const image = yield* imageFixture();
      const receipt = yield* copyImageBytes({ ...image, sizeBytes: IMAGE_BYTES });
      expect(receipt.sizeBytes).toBe(IMAGE_BYTES);
      expect(String(receipt.digest)).toBe(
        new Bun.CryptoHasher('sha256').update(image.payload).digest('hex'),
      );
      const reader = yield* imageHandle({ path: image.destinationPath, flag: 'r' });
      yield* verifyImageBytes({ image: reader, ...receipt });
      expect(yield* fs.readFile(image.destinationPath)).toEqual(image.payload);
      expect(yield* fs.readFile(image.sourcePath)).toEqual(image.payload);
    }),
  );
});

test('size disagreement refuses copying before writing destination bytes', async () => {
  await run(
    Effect.gen(function* () {
      const image = yield* imageFixture();
      const result = yield* Effect.either(
        copyImageBytes({ ...image, sizeBytes: SMALLER_IMAGE_BYTES }),
      );
      expect(result._tag).toBe('Left');
      expect((yield* Effect.promise(() => image.destination.stat())).size).toBe(0);
    }),
  );
});

test('an entirely sparse image retains its full logical size and checksum', async () => {
  await run(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const image = yield* imageFixture();
      yield* fs.truncate(image.sourcePath, 0);
      yield* fs.truncate(image.sourcePath, IMAGE_BYTES);
      const receipt = yield* copyImageBytes({ ...image, sizeBytes: IMAGE_BYTES });
      const reader = yield* imageHandle({ path: image.destinationPath, flag: 'r' });
      yield* verifyImageBytes({ image: reader, ...receipt });
      expect((yield* Effect.promise(() => reader.stat())).size).toBe(IMAGE_BYTES);
      expect(yield* fs.readFile(image.destinationPath)).toEqual(new Uint8Array(IMAGE_BYTES));
    }),
  );
});

test('a nonempty destination is not overwritten', async () => {
  await run(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const image = yield* imageFixture();
      const marker = 'already-owned destination';
      yield* fs.writeFileString(image.destinationPath, marker);
      expect(yield* Effect.isFailure(copyImageBytes({ ...image, sizeBytes: IMAGE_BYTES }))).toBe(
        true,
      );
      expect(yield* fs.readFileString(image.destinationPath)).toBe(marker);
      expect(yield* fs.readFile(image.sourcePath)).toEqual(image.payload);
    }),
  );
});

test('a write failure is sanitized and leaves the source intact', async () => {
  await run(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const image = yield* imageFixture();
      const destination = yield* imageHandle({ path: image.destinationPath, flag: 'r' });
      const result = yield* Effect.either(
        copyImageBytes({ source: image.source, destination, sizeBytes: IMAGE_BYTES }),
      );
      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left._tag).toBe('VolumeImageCopyFailed');
        expect(result.left.message).not.toContain(image.destinationPath);
      }
      expect(yield* fs.readFile(image.sourcePath)).toEqual(image.payload);
    }),
  );
});

test('verification detects corruption and truncation after copying', async () => {
  await run(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const image = yield* imageFixture();
      const receipt = yield* copyImageBytes({ ...image, sizeBytes: IMAGE_BYTES });
      const corrupted = new Uint8Array(image.payload);
      corrupted[0] = PATTERN_PERIOD;
      yield* fs.writeFile(image.destinationPath, corrupted);
      const reader = yield* imageHandle({ path: image.destinationPath, flag: 'r' });
      expect(yield* Effect.isFailure(verifyImageBytes({ image: reader, ...receipt }))).toBe(true);
      yield* Effect.promise(() => image.destination.truncate(0));
      expect(yield* Effect.isFailure(verifyImageBytes({ image: reader, ...receipt }))).toBe(true);
      expect(yield* fs.readFile(image.sourcePath)).toEqual(image.payload);
    }),
  );
});

test('interruption after writing starts returns no verified copy and preserves the source', async () => {
  await run(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* temporaryDirectory;
      const sourcePath = join(directory, 'source');
      const destinationPath = join(directory, 'destination');
      yield* fs.writeFileString(sourcePath, SOURCE_MARKER);
      yield* fs.truncate(sourcePath, INTERRUPTED_IMAGE_BYTES);
      const source = yield* imageHandle({ path: sourcePath, flag: 'r' });
      const destination = yield* imageHandle({ path: destinationPath, flag: 'wx' });
      const before = yield* Effect.promise(() => source.stat());
      const copying = yield* copyImageBytes({
        source,
        destination,
        sizeBytes: INTERRUPTED_IMAGE_BYTES,
      }).pipe(Effect.forkScoped);
      yield* fs.stat(destinationPath).pipe(
        Effect.repeat({
          schedule: Schedule.spaced('1 millis'),
          until: (stat) => Number(stat.size) > 0,
        }),
      );
      expect(Exit.isInterrupted(yield* Fiber.interrupt(copying))).toBe(true);
      const after = yield* Effect.promise(() => source.stat());
      expect([after.size, after.mtimeMs, after.ctimeMs]).toEqual([
        before.size,
        before.mtimeMs,
        before.ctimeMs,
      ]);
      const prefix = Buffer.alloc(SOURCE_MARKER.length);
      yield* Effect.promise(() => source.read(prefix, 0, prefix.length, 0));
      expect(prefix.toString()).toBe(SOURCE_MARKER);
    }).pipe(Effect.timeout('10 seconds')),
  );
});
