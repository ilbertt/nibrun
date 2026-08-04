import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DesiredArtifact, ObjectKey, Sha256Digest } from '@repo/protocol';
import { EmptyDumpError, writeBundle } from '#exports/bundle.ts';
import type { CommandRequest, CommandResult } from '#lib/exec.ts';
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

const artifact = (): DesiredArtifact => ({
  digest: new Bun.CryptoHasher('sha256').update(BINARY_BYTES).digest('hex') as Sha256Digest,
  sizeBytes: BINARY_BYTES.byteLength,
  objectKey: 'artifacts/app-1/server' as ObjectKey,
});

let stagingDir: string;

beforeEach(async () => {
  stagingDir = await mkdtemp(join(tmpdir(), 'bundle-test-'));
});

afterEach(async () => {
  await rm(stagingDir, { recursive: true, force: true });
});

// The dump is what a real `debugfs` would leave behind, so the tar step downstream has
// something to archive.
const runnerWritingDump = (calls: CommandRequest[]) => async (request: CommandRequest) => {
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

test('archives the data tree and the binary, and not the archive itself', async () => {
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
    'server',
  ]);
  expect(tar?.command).not.toContain('.');
  expect(bundle.sizeBytes).toBeGreaterThan(0);
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
