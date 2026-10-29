import { expect, test } from 'bun:test';
import { FileSystem } from '@effect/platform';
import { Effect } from 'effect';
import { nibrunnerReportedState } from '#lib/nibrunner/reported-state.ts';
import {
  readNibrunnerDesiredDigest,
  readNibrunnerReport,
  writeNibrunnerDesired,
} from '#lib/nibrunner/state-files.ts';
import { desiredExport, desiredState, HOST_ID, OBSERVED_AT } from '#tests/support/fixtures.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';

const run = provided(platform);

test('the digest matches the exact file bytes and unchanged polls do not replace the file', async () => {
  await run(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = `${yield* temporaryDirectory}/desired.json`;
      const desired = desiredState();
      const digest = yield* writeNibrunnerDesired({ path, desired });
      const text = yield* fs.readFileString(path);
      expect(new Bun.CryptoHasher('sha256').update(text).digest('hex')).toBe(digest);
      expect(yield* readNibrunnerDesiredDigest({ path, hostId: HOST_ID })).toBe(digest);
      const before = yield* fs.stat(path);
      expect(yield* writeNibrunnerDesired({ path, desired })).toBe(digest);
      expect((yield* fs.stat(path)).ino).toEqual(before.ino);
      expect(text.endsWith('\n')).toBe(true);
      yield* fs.writeFileString(path, text.trimEnd());
      expect(yield* readNibrunnerDesiredDigest({ path, hostId: HOST_ID })).not.toBe(digest);
    }),
  );
});

test('unsupported desired state leaves the authoritative engine document intact', async () => {
  await run(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = `${yield* temporaryDirectory}/desired.json`;
      yield* writeNibrunnerDesired({ path, desired: desiredState() });
      const before = yield* fs.readFileString(path);
      const result = yield* Effect.either(
        writeNibrunnerDesired({
          path,
          desired: desiredState({ exports: [desiredExport()] }),
        }),
      );
      expect(result._tag).toBe('Left');
      expect(yield* fs.readFileString(path)).toBe(before);
    }),
  );
});

test('a foreign desired document cannot supply the expected report digest', async () => {
  await run(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = `${yield* temporaryDirectory}/desired.json`;
      yield* fs.writeFileString(path, JSON.stringify({ hostId: 'another-host' }));
      expect((yield* Effect.flip(readNibrunnerDesiredDigest({ path, hostId: HOST_ID })))._tag).toBe(
        'ForeignNibrunnerDocument',
      );
    }),
  );
});

test('a file report is validated and fenced against the published document', async () => {
  await run(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* temporaryDirectory;
      const desiredDigest = yield* writeNibrunnerDesired({
        path: `${directory}/desired.json`,
        desired: desiredState(),
      });
      const path = `${directory}/reported.json`;
      const capacity = { vcpuCount: 4, memoryMib: 8192, cacheBytes: 1000 };
      yield* fs.writeFileString(
        path,
        JSON.stringify({
          hostId: HOST_ID,
          reportedAt: OBSERVED_AT,
          state: 'ready',
          capacity,
          allocatable: capacity,
          versions: {
            agent: '2026.10.7',
            firecracker: 'v1.16.1',
            guestImage: 'guest',
            zerofs: 'none',
          },
          volumes: [],
          instances: [],
          checkpoints: [],
          exports: [],
          acceptedDigest: desiredDigest,
        }),
      );
      const { value, report } = yield* readNibrunnerReport(path);
      expect(report.capacity).toEqual(capacity);
      const forwarded = yield* nibrunnerReportedState({
        value,
        hostId: HOST_ID,
        desiredDigest,
        nowMs: Date.parse(OBSERVED_AT),
        maxAgeMs: 30_000,
        admissionState: 'draining',
      });
      expect(forwarded.state).toBe('draining');
      expect(forwarded).not.toHaveProperty('acceptedDigest');
      yield* fs.writeFileString(path, JSON.stringify({ capacity: 'tenant-secret-value' }));
      const error = yield* Effect.flip(readNibrunnerReport(path));
      expect(error._tag).toBe('ProtocolMismatch');
      expect(JSON.stringify(error)).not.toContain('tenant-secret-value');
      yield* fs.writeFileString(path, '{ tenant-secret-value');
      const malformed = yield* Effect.flip(readNibrunnerReport(path));
      expect(malformed._tag).toBe('MalformedNibrunnerFile');
      expect(JSON.stringify(malformed)).not.toContain('tenant-secret-value');
      yield* fs.remove(path);
      expect((yield* Effect.flip(readNibrunnerReport(path)))._tag).toBe('MissingNibrunnerFile');
    }),
  );
});
