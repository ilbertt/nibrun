import { describe, expect, test } from 'bun:test';
import { lstat, mkdir, readdir, readFile, readlink, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect, Either } from 'effect';
import { type Owner, type SeedLimits, unpackSeed } from '#lib/volumes/seed.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';
import {
  gzippedTarball,
  type TarballEntry,
  TYPE_CHAR_DEVICE,
  TYPE_DIRECTORY,
  TYPE_HARDLINK,
  TYPE_SYMLINK,
} from '#tests/support/tarball.ts';

const run = provided(platform);

const ALL_MODE_BITS = 0o7777;
const PRIVATE_FILE_MODE = 0o640;
const PRIVATE_DIRECTORY_MODE = 0o750;
const RUNNABLE_MODE = 0o755;
const SETUID_RUNNABLE_MODE = 0o4755;

/**
 * The process's own, not the tenant's. Only root may give a file away, so the thing a host does —
 * hand the tree to uid 65534 — is not something a test can do; what it can prove is that every
 * entry ends up owned by whoever the unpack was told to give it to.
 */
const OWNER: Owner = { uid: process.getuid?.() ?? 0, gid: process.getgid?.() ?? 0 };

/** Far below the host's, so a bound can be reached without staging what the real one allows. */
const SMALL: SeedLimits = { maxBytes: 4096, maxEntries: 4 };

/** Room for an ordinary archive, which is what every test not aiming at a bound wants. */
const ROOMY: SeedLimits = { maxBytes: 1_048_576, maxEntries: 64 };

type Written = {
  readonly names: readonly string[];
  readonly content: Readonly<Record<string, string>>;
  readonly links: Readonly<Record<string, string>>;
  readonly modes: Readonly<Record<string, number>>;
  readonly owners: Readonly<Record<string, string>>;
};

/**
 * Read inside the scope that owns the directory, as the export bundle's tests are: the tree is
 * gone by the time an assertion runs.
 */
async function surveyed(destination: string): Promise<Written> {
  const entries = await readdir(destination, { recursive: true, withFileTypes: true }).catch(
    () => [],
  );
  const written: Written = { names: [], content: {}, links: {}, modes: {}, owners: {} };
  const names: string[] = [];
  const content: Record<string, string> = {};
  const links: Record<string, string> = {};
  const modes: Record<string, number> = {};
  const owners: Record<string, string> = { '.': await ownerOf(destination) };
  for (const entry of entries) {
    const path = join(entry.parentPath, entry.name);
    const name = path.slice(destination.length + 1);
    names.push(name);
    modes[name] = (await lstat(path)).mode & ALL_MODE_BITS;
    owners[name] = await ownerOf(path);
    if (entry.isSymbolicLink()) {
      links[name] = await readlink(path);
    } else if (entry.isFile()) {
      content[name] = await readFile(path, 'utf8');
    }
  }
  return { ...written, names: names.sort(), content, links, modes, owners };
}

async function ownerOf(path: string): Promise<string> {
  const stats = await lstat(path);
  return `${stats.uid}:${stats.gid}`;
}

function unpacking({
  entries,
  limits = ROOMY,
}: {
  entries: readonly TarballEntry[];
  limits?: SeedLimits;
}) {
  return Effect.gen(function* () {
    const directory = yield* temporaryDirectory;
    const archivePath = join(directory, 'archive.tar.gz');
    yield* Effect.promise(() => writeFile(archivePath, gzippedTarball(entries)));
    const destination = join(directory, 'tree');
    const result = yield* Effect.either(
      unpackSeed({ archivePath, destination, owner: OWNER, limits }),
    );
    return {
      refusal: refusalOf(result),
      written: yield* Effect.promise(() => surveyed(destination)),
    };
  });
}

const NOTHING_REFUSED = 'nothing was refused';

/** The refusal as an operator reads it, which is the message rather than the tag. */
function refusalOf(result: Either.Either<unknown, { message: string }>): string {
  return Either.isLeft(result) ? result.left.message : NOTHING_REFUSED;
}

describe("the archive's root becomes the root of the tree", () => {
  test('files, directories and symlinks arrive where the archive put them', async () => {
    const { refusal, written } = await run(
      unpacking({
        entries: [
          { path: 'pb_data/', type: TYPE_DIRECTORY, mode: PRIVATE_DIRECTORY_MODE },
          { path: 'pb_data/data.db', mode: PRIVATE_FILE_MODE, body: 'rows' },
          { path: 'latest', type: TYPE_SYMLINK, linkTarget: 'pb_data/data.db' },
        ],
      }),
    );

    expect(refusal).toBe(NOTHING_REFUSED);
    expect(written.content['pb_data/data.db']).toBe('rows');
    expect(written.links.latest).toBe('pb_data/data.db');
    expect(written.modes['pb_data/data.db']).toBe(PRIVATE_FILE_MODE);
    expect(written.modes.pb_data).toBe(PRIVATE_DIRECTORY_MODE);
  });

  test('a parent the archive never declared is made anyway', async () => {
    const { refusal, written } = await run(
      unpacking({ entries: [{ path: 'deep/tree/data.db', body: 'rows' }] }),
    );

    expect(refusal).toBe(NOTHING_REFUSED);
    expect(written.content['deep/tree/data.db']).toBe('rows');
  });

  test('everything written belongs to whoever the unpack was told to give it to', async () => {
    const { written } = await run(
      unpacking({
        entries: [
          { path: 'pb_data/', type: TYPE_DIRECTORY },
          { path: 'pb_data/data.db', body: 'rows' },
        ],
      }),
    );

    const expected = `${OWNER.uid}:${OWNER.gid}`;
    expect(written.owners).toEqual({
      '.': expected,
      pb_data: expected,
      'pb_data/data.db': expected,
    });
  });

  test('a setuid bit in the archive is not a setuid file on the host', async () => {
    const { written } = await run(
      unpacking({ entries: [{ path: 'helper', mode: SETUID_RUNNABLE_MODE }] }),
    );

    // Masked to every mode bit when it was read back, so this is also "and nothing above them".
    expect(written.modes.helper).toBe(RUNNABLE_MODE);
  });
});

describe('an entry that could reach outside the tree is refused', () => {
  test('an absolute path', async () => {
    const { refusal, written } = await run(
      unpacking({ entries: [{ path: '/etc/passwd', body: 'root' }] }),
    );

    expect(refusal).toContain('starts at the root of a filesystem');
    expect(written.names).toEqual([]);
  });

  test('a path that climbs out', async () => {
    const { refusal } = await run(unpacking({ entries: [{ path: '../escaped', body: 'x' }] }));

    expect(refusal).toContain('climbs out of the archive');
  });

  test('a symlink pointing out of the archive', async () => {
    const { refusal } = await run(
      unpacking({ entries: [{ path: 'escape', type: TYPE_SYMLINK, linkTarget: '../../etc' }] }),
    );

    expect(refusal).toContain('pointing out of the archive');
  });

  test('an absolute symlink', async () => {
    const { refusal } = await run(
      unpacking({ entries: [{ path: 'escape', type: TYPE_SYMLINK, linkTarget: '/etc' }] }),
    );

    expect(refusal).toContain('pointing out of the archive');
  });

  /**
   * The one the containment check alone would not catch: `here` stays inside, and an entry written
   * through it would land wherever it points once the tree is somewhere else.
   */
  test('an entry underneath a symlink the archive just made', async () => {
    const { refusal, written } = await run(
      unpacking({
        entries: [
          { path: 'here', type: TYPE_SYMLINK, linkTarget: 'pb_data' },
          { path: 'here/data.db', body: 'rows' },
        ],
      }),
    );

    expect(refusal).toContain('reached through a symlink');
    expect(written.links.here).toBe('pb_data');
    expect(written.names).toEqual(['here']);
  });

  test('a symlink that stays inside is written', async () => {
    const { refusal, written } = await run(
      unpacking({
        entries: [
          { path: 'pb_data/data.db', body: 'rows' },
          { path: 'pb_data/latest', type: TYPE_SYMLINK, linkTarget: '../pb_data/data.db' },
        ],
      }),
    );

    expect(refusal).toBe(NOTHING_REFUSED);
    expect(written.links['pb_data/latest']).toBe('../pb_data/data.db');
  });
});

describe('an entry that is not a file, a directory or a symlink is refused', () => {
  test('a device node', async () => {
    const { refusal } = await run(
      unpacking({ entries: [{ path: 'dev/null', type: TYPE_CHAR_DEVICE }] }),
    );

    expect(refusal).toContain('not a file, a directory or a symlink');
  });

  test('a hard link, which would carry whatever it names into the filesystem', async () => {
    const { refusal } = await run(
      unpacking({ entries: [{ path: 'shadow', type: TYPE_HARDLINK, linkTarget: '/etc/shadow' }] }),
    );

    expect(refusal).toContain('not a file, a directory or a symlink');
  });
});

describe('what the archive expands to is bounded, not just what it sent', () => {
  test('a declared size past the ceiling ends the unpack before the bytes are spent', async () => {
    const { refusal, written } = await run(
      unpacking({
        entries: [
          { path: 'small', body: 'rows' },
          { path: 'bomb', declaredSize: SMALL.maxBytes + 1 },
        ],
        limits: SMALL,
      }),
    );

    expect(refusal).toContain('bytes an app may be seeded with');
    expect(written.names).toEqual(['small']);
  });

  test('an archive that is headers the whole way down is bounded by their count', async () => {
    const { refusal } = await run(
      unpacking({
        entries: [...Array(SMALL.maxEntries + 1).keys()].map((index) => ({
          path: `d${index}`,
          type: TYPE_DIRECTORY,
        })),
        limits: SMALL,
      }),
    );

    expect(refusal).toContain('files an app may be seeded with');
  });
});

test('bytes that are not a gzipped tarball are refused rather than half unpacked', async () => {
  const refusal = await run(
    Effect.gen(function* () {
      const directory = yield* temporaryDirectory;
      const archivePath = join(directory, 'archive.tar.gz');
      yield* Effect.promise(() => writeFile(archivePath, 'not an archive'));
      return refusalOf(
        yield* Effect.either(
          unpackSeed({
            archivePath,
            destination: join(directory, 'tree'),
            owner: OWNER,
            limits: SMALL,
          }),
        ),
      );
    }),
  );

  expect(refusal).not.toBe(NOTHING_REFUSED);
});

/**
 * `tar cf archive.tar .` is how an owner is likeliest to make one, and it writes the tree's own
 * root as `./` with every path under it as `./…`. Nothing here is spelled out block by block, so
 * this is also the one test that proves the walk against a real tar's output end to end.
 */
test('an archive a real tar wrote from the tree root unpacks whole', async () => {
  const { refusal, written } = await run(
    Effect.gen(function* () {
      const directory = yield* temporaryDirectory;
      const source = join(directory, 'source');
      yield* Effect.promise(async () => {
        await mkdir(join(source, 'pb_data'), { recursive: true });
        await writeFile(join(source, 'pb_data', 'data.db'), 'rows');
        await symlink('pb_data/data.db', join(source, 'latest'));
      });
      const archivePath = join(directory, 'archive.tar.gz');
      yield* Effect.promise(() => Bun.$`tar czf ${archivePath} -C ${source} .`.quiet());
      const destination = join(directory, 'tree');
      const result = yield* Effect.either(
        unpackSeed({ archivePath, destination, owner: OWNER, limits: ROOMY }),
      );
      return {
        refusal: refusalOf(result),
        written: yield* Effect.promise(() => surveyed(destination)),
      };
    }),
  );

  expect(refusal).toBe(NOTHING_REFUSED);
  expect(written.content['pb_data/data.db']).toBe('rows');
  expect(written.links.latest).toBe('pb_data/data.db');
});
