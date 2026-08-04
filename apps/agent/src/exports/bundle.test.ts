import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DesiredArtifact, Filename, ObjectKey, Sha256Digest } from '@repo/protocol';
import {
  bundleBinaryName,
  EmptyDumpError,
  UnsafeFilenameError,
  writeBundle,
} from '#exports/bundle.ts';
import type { CommandRequest, CommandResult, CommandRunner } from '#lib/exec.ts';
import type { ArtifactBytes } from '#vm/artifacts.ts';

const DEVICE_PATH = '/dev/nbd7';
const BINARY_BYTES = new TextEncoder().encode('binary');
const OK: CommandResult = { code: 0, stdout: '', stderr: '' };

const artifacts: ArtifactBytes = {
  open: () =>
    Promise.resolve(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(BINARY_BYTES);
          controller.close();
        },
      }),
    ),
};

function artifact(overrides: Partial<DesiredArtifact> = {}): DesiredArtifact {
  return {
    digest: new Bun.CryptoHasher('sha256').update(BINARY_BYTES).digest('hex') as Sha256Digest,
    sizeBytes: BINARY_BYTES.byteLength,
    // A uuid, as the api will assign: it carries no name, which is why `filename` exists.
    objectKey: 'artifacts/9f1c2f0e-0d4e-4a1b-9c3a-1f8b6d2e7a45' as ObjectKey,
    filename: 'pocketbase' as Filename,
    ...overrides,
  };
}

let stagingDir: string;

beforeEach(async () => {
  stagingDir = await mkdtemp(join(tmpdir(), 'bundle-test-'));
});

afterEach(async () => {
  await rm(stagingDir, { recursive: true, force: true });
});

// The dump is what a real `debugfs` would leave behind, so the tar step downstream has
// something to archive.
function runnerWritingDump(calls: CommandRequest[]): CommandRunner {
  return async (request: CommandRequest) => {
    calls.push(request);
    const [command] = request.command;
    if (command === 'debugfs') {
      const destination = join(stagingDir, 'data');
      await mkdir(join(destination, 'pb_data'), { recursive: true });
      await writeFile(join(destination, 'pb_data', 'data.db'), 'tenant');
    }
    if (command === 'tar') {
      await writeFile(join(stagingDir, 'bundle.tar.gz'), 'archive');
    }
    return OK;
  };
}

test('reads the device with debugfs and never mounts it', async () => {
  const calls: CommandRequest[] = [];
  await writeBundle({
    runner: runnerWritingDump(calls),
    artifacts,
    artifact: artifact(),
    devicePath: DEVICE_PATH,
    stagingDir,
  });

  const dump = calls.find((call) => call.command[0] === 'debugfs');
  expect(dump?.command).toEqual([
    'debugfs',
    '-R',
    `rdump / ${join(stagingDir, 'data')}`,
    DEVICE_PATH,
  ]);
  expect(calls.some((call) => call.command[0] === 'mount')).toBe(false);
  // No `-w`: a read-only open is what keeps the export off the tenant's write path.
  expect(dump?.command).not.toContain('-w');
});

test('archives the data tree and the binary under its uploaded name', async () => {
  const calls: CommandRequest[] = [];
  const bundle = await writeBundle({
    runner: runnerWritingDump(calls),
    artifacts,
    artifact: artifact(),
    devicePath: DEVICE_PATH,
    stagingDir,
  });

  const tar = calls.find((call) => call.command[0] === 'tar');
  expect(tar?.command).toEqual([
    'tar',
    'czf',
    join(stagingDir, 'bundle.tar.gz'),
    '-C',
    stagingDir,
    'data',
    'pocketbase',
  ]);
  // `.` would sweep the archive into itself.
  expect(tar?.command).not.toContain('.');
  expect(bundle.sizeBytes).toBeGreaterThan(0);
});

describe('the bundle keeps the name the binary was uploaded under', () => {
  test('the uploaded name is what lands in the archive', () => {
    expect(bundleBinaryName(artifact({ filename: 'pocketbase' as Filename }))).toBe('pocketbase');
  });

  // The schema rejects all of these, so reaching here means a peer that did not honour it.
  // The bundle is extracted by a person on their own machine; a name that escapes the archive
  // root writes wherever the traversal points, so it fails rather than being corrected.
  test.each(['../escape', 'nested/path', '.hidden', '..', '-rf'])(
    'a name that is a path rather than a filename is refused: %s',
    (hostile) => {
      expect(() => bundleBinaryName(artifact({ filename: hostile as Filename }))).toThrow(
        UnsafeFilenameError,
      );
    },
  );
});

test('a dump that produced nothing is an error rather than an empty bundle', () => {
  const runner = async (request: CommandRequest) => {
    if (request.command[0] === 'tar') {
      await writeFile(join(stagingDir, 'bundle.tar.gz'), 'archive');
    }
    return OK;
  };

  expect(
    writeBundle({
      runner,
      artifacts,
      artifact: artifact(),
      devicePath: DEVICE_PATH,
      stagingDir,
    }),
  ).rejects.toThrow(EmptyDumpError);
});
