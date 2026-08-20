import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// Shared with the build script, which embeds these folders into the binary under
// the same names.
export const DB_MIGRATIONS_DIR_NAME = 'migrations';
export const PUBLIC_DASHBOARD_DIR_NAME = 'public';

// `--asset <folder>` mounts each tree under its own basename at `import.meta.dir`, reachable
// through `node:fs` like any other directory — so a compiled binary and a checkout differ only in
// where the walk starts.
const DB_MIGRATIONS_DIR = Bun.isStandaloneExecutable
  ? join(import.meta.dir, DB_MIGRATIONS_DIR_NAME)
  : resolve(import.meta.dir, '..', 'db', DB_MIGRATIONS_DIR_NAME);
const PUBLIC_DASHBOARD_DIR = Bun.isStandaloneExecutable
  ? join(import.meta.dir, PUBLIC_DASHBOARD_DIR_NAME)
  : resolve(import.meta.dir, '..', '..', PUBLIC_DASHBOARD_DIR_NAME);

/** Keyed by the path of the file relative to the folder it came from. */
export type AssetFiles = Map<string, Blob>;

export function getMigrations(): AssetFiles {
  return readFolder(DB_MIGRATIONS_DIR);
}

export function getPublicAssets(): AssetFiles {
  return readFolder(PUBLIC_DASHBOARD_DIR);
}

function readFolder(folder: string): AssetFiles {
  if (!existsSync(folder)) {
    return new Map();
  }

  const files: AssetFiles = new Map();
  for (const entry of readdirSync(folder, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    const filePath = join(entry.parentPath, entry.name);
    // Read eagerly rather than handing on a lazy BunFile: a static route can't stream one, it
    // needs the body in memory.
    const contents = readFileSync(filePath);
    files.set(relative(folder, filePath), new Blob([contents], { type: Bun.file(filePath).type }));
  }
  return sortedByPath(files);
}

// Migrations run in name order, which a directory walk does not promise.
function sortedByPath(files: AssetFiles): AssetFiles {
  // biome-ignore lint/complexity/useMaxParams: a comparator compares two entries
  return new Map([...files].sort(([a], [b]) => (a < b ? -1 : 1)));
}
