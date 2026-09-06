import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { refusedArchiveBody, type UploadableArchive } from '@repo/app-operations';
import { type Filename, FilenameSchema, Value } from '@repo/protocol';
import { UsageError } from '#lib/errors.ts';
import type { Ui } from '#lib/ui.ts';

const ARCHIVE_SUFFIX = '.tar.gz';
const STAGING_PREFIX = 'nib-data-';
const TAR_SUCCEEDED = 0;

/**
 * The folder an app's data is to be created from, as a path this machine actually has — or nothing
 * where none was given.
 *
 * Answered before anything is created or packed, so a folder nobody can read costs one line rather
 * than an app made for a deploy that cannot go on, or a gibibyte packed and sent for a deployment
 * the api will refuse.
 */
export async function dataFolderFor({
  path,
  app,
}: {
  path?: string | undefined;
  app?: string | undefined;
}): Promise<string | undefined> {
  if (path === undefined) {
    return undefined;
  }
  // An app's data is created once, as the app is. A slug names one that already exists, so the two
  // flags cannot both be meant — and which one was is not this end's to guess.
  if (app !== undefined) {
    throw new UsageError(
      `--data-folder gives a new app the data it starts with, and --app ${app} names one that already has its own.`,
    );
  }
  return await readableFolder(path);
}

async function readableFolder(path: string): Promise<string> {
  const folder = resolve(path);
  const found = await stat(folder).catch(() => undefined);
  if (found === undefined) {
    throw new UsageError(`No such folder: ${path}`);
  }
  if (!found.isDirectory()) {
    throw new UsageError(
      `--data-folder takes the folder an app's data starts as, and this is a file: ${path}`,
    );
  }
  if ((await readdir(folder)).length === 0) {
    throw new UsageError(`There is nothing in ${path} to give the app as its data.`);
  }
  return folder;
}

/** An archive on this machine, and the way to stop it being one once it has been sent. */
export type PackedFolder = {
  archive: UploadableArchive;
  discard: () => Promise<void>;
};

/**
 * The folder as one gzipped tarball, written to disk rather than held: the api signs the upload for
 * exactly the length it is told, so the archive has to exist in full before there is a number to
 * declare — and a dataset is the last thing to keep in memory to measure.
 *
 * Packed from inside the folder, so what the archive holds is the folder's *contents*: the root of
 * the archive becomes the root of `data/`, and packing the folder itself would put every file one
 * directory deeper than the app goes looking for it.
 */
export async function packDataFolder({
  folder,
  ui,
  limitBytes,
}: {
  folder: string;
  ui: Ui;
  limitBytes?: number;
}): Promise<PackedFolder> {
  const staging = await mkdtemp(join(tmpdir(), STAGING_PREFIX));
  const name = archiveName(folder);
  const path = join(staging, name);

  async function discard(): Promise<void> {
    await rm(staging, { recursive: true, force: true });
  }

  try {
    await ui.waitingFor({
      message: `packing ${folder}`,
      task: () => pack({ folder, into: path }),
    });
    const archive = { name, body: Bun.file(path) };
    // `uploadImport` asks this too, but only once an app has been created and a binary uploaded
    // against it — so asking here is the difference between a sentence and an app the owner has to
    // go and delete. What it packed to is knowable no earlier than this: compression is what
    // decides it, so no reading of the folder could have said.
    const refusal = await refusedArchiveBody({ ...archive, ...(limitBytes && { limitBytes }) });
    if (refusal) {
      throw new UsageError(refusal);
    }
    return { archive, discard };
  } catch (failure) {
    await discard();
    throw failure;
  }
}

/**
 * `tar` rather than an archiver of our own: what a seed needs written is every kind of entry a
 * filesystem holds, at every length a path comes in, and the one end that unpacks it was written
 * against what `tar` writes.
 *
 * `COPYFILE_DISABLE` is macOS's: its `tar` otherwise stores each extended attribute as a `._`
 * entry beside the file it belongs to, which would reach the app as files it never had.
 */
async function pack({ folder, into }: { folder: string; into: string }): Promise<void> {
  const packing = Bun.spawn(['tar', '-czf', into, '-C', folder, '.'], {
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'pipe',
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  });
  const complaint = (await new Response(packing.stderr).text()).trim();
  const status = await packing.exited;
  if (status !== TAR_SUCCEEDED) {
    throw new UsageError(
      `${folder} could not be packed: ${complaint === '' ? `tar exited ${status}` : complaint}`,
    );
  }
}

/**
 * What the archive is called, which is the only name its owner would recognise it by afterwards.
 * Refused rather than repaired where the api would not take it: the folder is theirs to rename,
 * and a name invented here is one they would not know their own upload by.
 */
function archiveName(folder: string): Filename {
  const name = `${basename(folder)}${ARCHIVE_SUFFIX}`;
  try {
    return Value.Parse(FilenameSchema, name);
  } catch {
    throw new UsageError(
      `An archive is named after the folder it holds, and ${name} is not a name nibrun takes: it must start with a letter or digit and hold only letters, digits, dots, dashes or underscores.`,
    );
  }
}
