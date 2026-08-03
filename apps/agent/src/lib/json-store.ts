import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIR_MODE = 0o700;
const JSON_INDENT = 2;

export async function readJsonFile({ path }: { path: string }): Promise<unknown> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return undefined;
  }
  return file.json();
}

/**
 * Writes through a sibling temporary file and renames, so a torn write can never leave the
 * agent with a state file it cannot parse. Rename within a directory is atomic on ext4.
 */
export async function writeJsonFile({
  path,
  value,
}: {
  path: string;
  value: unknown;
}): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: PRIVATE_DIR_MODE });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, JSON_INDENT)}\n`, {
    mode: PRIVATE_FILE_MODE,
  });
  await rename(temporaryPath, path);
}

export async function readTextFile({ path }: { path: string }): Promise<string | undefined> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return undefined;
  }
  return (await file.text()).trim();
}

export async function writeTextFile({
  path,
  value,
  mode = PRIVATE_FILE_MODE,
}: {
  path: string;
  value: string;
  // Private unless the file is meant for another process on the host to read.
  mode?: number;
}): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: PRIVATE_DIR_MODE });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, value, { mode });
  await rename(temporaryPath, path);
}
