import { describe, expect, test } from 'bun:test';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type Filename,
  FilenameSchema,
  SecretStringSchema,
  type TenantEnvironment,
  Value,
} from '@repo/protocol';
import { Effect, Either, Layer } from 'effect';
import { bundleBinaryName, dumpVolume, renderDotenv, writeBundle } from '#lib/exports/bundle.ts';
import { artifactStore } from '#tests/support/artifacts.ts';
import { recordingCommands, succeeding } from '#tests/support/commands.ts';
import { artifact } from '#tests/support/fixtures.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';

const DEVICE_PATH = '/dev/nbd7';
const PERMISSION_BITS = 0o777;
/** Spelled out rather than imported: what the archive has to carry, not what the source says it does. */
const RUNNABLE_MODE = 0o755;
const PRIVATE_MODE = 0o600;

function environment(values: Record<string, string>): TenantEnvironment {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, Value.Parse(SecretStringSchema, value)]),
  );
}

const run = provided(Layer.merge(artifactStore(), platform));

/** `lost+found` is written by `mkfs.ext4`, so a real `rdump` of any root always produces it. */
const DUMPS = {
  tenant: async (dataDir: string) => {
    await mkdir(join(dataDir, 'pb_data'), { recursive: true });
    await writeFile(join(dataDir, 'pb_data', 'data.db'), 'tenant');
    await mkdir(join(dataDir, 'lost+found'), { recursive: true });
  },
  'mkfs-only': async (dataDir: string) => {
    await mkdir(join(dataDir, 'lost+found'), { recursive: true });
  },
  none: () => Promise.resolve(),
} as const;

/**
 * What a real `debugfs` and `tar` would leave behind, so each step downstream has its input. The
 * staging tree is read inside the scope that owns it, because it is gone by the time the test
 * body resumes.
 */
function bundling({
  dumps = 'tenant',
  variables = {},
}: {
  dumps?: keyof typeof DUMPS;
  variables?: Record<string, string>;
} = {}) {
  return Effect.gen(function* () {
    const stagingDir = yield* temporaryDirectory;
    const dataDir = join(stagingDir, 'data');
    const { commands, layer } = recordingCommands(({ command }) =>
      Effect.gen(function* () {
        if (command[0] === 'debugfs') {
          yield* Effect.promise(() => DUMPS[dumps](dataDir));
        }
        if (command[0] === 'tar') {
          yield* Effect.promise(() => writeFile(join(stagingDir, 'bundle.tar.gz'), 'archive'));
        }
        return yield* succeeding();
      }),
    );

    const result = yield* Effect.either(
      Effect.provide(
        Effect.flatMap(dumpVolume({ devicePath: DEVICE_PATH, stagingDir }), () =>
          writeBundle({
            artifact: artifact(),
            environment: environment(variables),
            stagingDir,
          }),
        ),
        layer,
      ),
    );
    const archived = yield* Effect.promise(() => readdir(dataDir).catch(() => [] as string[]));
    const binaryMode = yield* Effect.promise(() =>
      stat(join(stagingDir, 'pocketbase'))
        .then((stats) => stats.mode & PERMISSION_BITS)
        .catch(() => null),
    );
    const dotenv = yield* Effect.promise(() =>
      readFile(join(stagingDir, '.env'), 'utf8').catch(() => null),
    );
    const dotenvMode = yield* Effect.promise(() =>
      stat(join(stagingDir, '.env'))
        .then((stats) => stats.mode & PERMISSION_BITS)
        .catch(() => null),
    );
    return { commands, result, stagingDir, archived, binaryMode, dotenv, dotenvMode };
  });
}

test('reads the device with debugfs and never mounts it', async () => {
  const { commands, stagingDir } = await run(bundling());

  const dump = commands.find((call) => call.command[0] === 'debugfs');
  expect(dump?.command).toEqual([
    'debugfs',
    '-R',
    `rdump / ${join(stagingDir, 'data')}`,
    DEVICE_PATH,
  ]);
  expect(commands.some((call) => call.command[0] === 'mount')).toBe(false);
  // No `-w`: a read-only open is what keeps the export off the tenant's write path.
  expect(dump?.command).not.toContain('-w');
});

test('archives the data tree, the binary under its uploaded name, and the environment', async () => {
  const { commands, result, stagingDir } = await run(bundling());

  const tar = commands.find((call) => call.command[0] === 'tar');
  expect(tar?.command).toEqual([
    'tar',
    'czf',
    join(stagingDir, 'bundle.tar.gz'),
    '-C',
    stagingDir,
    'data',
    'pocketbase',
    '.env',
  ]);
  // `.` would sweep the archive into itself.
  expect(tar?.command).not.toContain('.');
  expect(Either.isRight(result)).toBe(true);
});

// The bundle exists so the copy can be run, and `tar` records the mode the staging tree has. A
// transfer writes 0644, so without a chmod the binary arrives needing one.
test('the binary is archived able to run', async () => {
  const { binaryMode } = await run(bundling());

  expect(binaryMode).toBe(RUNNABLE_MODE);
});

test('a dump that produced nothing is a failure rather than an empty bundle', async () => {
  const { result } = await run(bundling({ dumps: 'none' }));

  expect(Either.isLeft(result) && result.left._tag).toBe('EmptyDump');
});

// Somebody extracting this on their own machine gets what they put in the volume, not the
// bookkeeping the filesystem needed to hold it.
test('what mkfs left at the root does not reach the archive', async () => {
  const { archived } = await run(bundling());

  expect(archived).toEqual(['pb_data']);
});

// The emptiness check has to see the raw dump: a volume holding only `lost+found` is a tenant who
// has written nothing, and reporting that as a failed read would fail their export forever.
test('a volume holding only that is an empty export rather than a failed one', async () => {
  const { result, archived } = await run(bundling({ dumps: 'mkfs-only' }));

  expect(Either.isRight(result)).toBe(true);
  expect(archived).toEqual([]);
});

// The bundle is what an owner runs somewhere else, and a binary handed over without the variables
// it was configured with is not one that runs.
describe('the environment the app ran with', () => {
  test('is written beside the binary', async () => {
    const { dotenv } = await run(bundling({ variables: { API_KEY: 'sk-live' } }));

    expect(dotenv).toBe('API_KEY="sk-live"\n');
  });

  // A tenant's secrets in the clear, and `tar` records the mode it finds, so this is also the mode
  // of the file whoever extracts the bundle ends up with.
  test('is readable by nobody but the owner it belongs to', async () => {
    const { dotenvMode } = await run(bundling({ variables: { API_KEY: 'sk-live' } }));

    expect(dotenvMode).toBe(PRIVATE_MODE);
  });

  // One shape for every bundle: an owner who set no variables reads that off an empty file rather
  // than off a missing one.
  test('is there even for an app that had none', async () => {
    const { dotenv } = await run(bundling());

    expect(dotenv).toBe('');
  });

  test('is written in a fixed order, so two bundles of the same app compare', () => {
    expect(renderDotenv(environment({ ZED: 'last', ALPHA: 'first' }))).toBe(
      'ALPHA="first"\nZED="last"\n',
    );
  });

  // `instance.env` refuses each of these, because the guest's init has no parser to unquote them.
  // This file has a reader that does, and an export must not be what fails on a value somebody set.
  test.each([
    { holds: 'a newline', value: 'one\ntwo', line: 'KEY="one\\ntwo"\n' },
    { holds: 'a quote', value: 'say "hi"', line: 'KEY="say \\"hi\\""\n' },
    { holds: 'a backslash', value: 'C:\\path', line: 'KEY="C:\\\\path"\n' },
  ])('carries a value holding $holds', ({ value, line }) => {
    expect(renderDotenv(environment({ KEY: value }))).toBe(line);
  });
});

describe('the bundle keeps the name the binary was uploaded under', () => {
  test('the uploaded name is what lands in the archive', () => {
    expect(
      bundleBinaryName(artifact({ filename: Value.Parse(FilenameSchema, 'pocketbase') })),
    ).toEqual(Either.right('pocketbase'));
  });

  // The schema rejects all of these, so reaching here means a peer that did not honour it. The
  // bundle is extracted by a person on their own machine, so a name that escapes the archive
  // root is refused rather than corrected.
  test.each(['../escape', 'nested/path', '.hidden', '..', '-rf'])(
    'a name that is a path rather than a filename is refused: %s',
    (hostile) => {
      const result = bundleBinaryName(artifact({ filename: hostile as Filename }));
      expect(Either.isLeft(result) && result.left._tag).toBe('UnsafeFilename');
    },
  );
});
