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
 * Where an app's starting data is coming from, as a path this machine actually has.
 *
 * A folder is packed here; an archive somebody already has is sent as it stands. Which of the two
 * a path is gets decided once, so that nothing downstream has to ask the filesystem again.
 */
export type InitialData =
  | { readonly kind: 'folder'; readonly path: string }
  | { readonly kind: 'archive'; readonly path: string };

/**
 * What `--data-folder` was given, or nothing where it was not.
 *
 * Answered before anything is created, packed or sent, so a path nobody can read costs one line
 * rather than an app made for a deploy that cannot go on.
 */
export async function initialDataFrom({
  path,
  app,
}: {
  path?: string | undefined;
  app?: string | undefined;
}): Promise<InitialData | undefined> {
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
  return await readable(path);
}

async function readable(path: string): Promise<InitialData> {
  const found = resolve(path);
  const stats = await stat(found).catch(() => undefined);
  if (stats === undefined) {
    throw new UsageError(`No such folder or archive: ${path}`);
  }
  if (!stats.isDirectory()) {
    return { kind: 'archive', path: found };
  }
  if ((await readdir(found)).length === 0) {
    throw new UsageError(`There is nothing in ${path} to give the app as its data.`);
  }
  return { kind: 'folder', path: found };
}

/** An archive on this machine, and the way to stop it being one once it has been sent. */
export type OpenedData = {
  archive: UploadableArchive;
  discard: () => Promise<void>;
};

/**
 * The data as one archive to send, and what to do with it afterwards.
 *
 * An archive the owner already has is opened rather than repacked: unpacking it here to pack it
 * again would spend the whole dataset twice to arrive at what they already handed over, and would
 * lose whatever their own archiver recorded on the way through.
 */
export async function openInitialData({
  data,
  ui,
  limitBytes,
}: {
  data: InitialData;
  ui: Ui;
  limitBytes?: number;
}): Promise<OpenedData> {
  return data.kind === 'archive'
    ? await openedArchive({ path: data.path, limitBytes })
    : await packedFolder({ folder: data.path, ui, limitBytes });
}

/**
 * Refused here rather than sent, for the reason a packed folder is: `uploadImport` asks the same
 * question, but only once an app has been created and a binary uploaded against it — so asking now
 * is the difference between a sentence and an app the owner has to go and delete.
 */
async function openedArchive({
  path,
  limitBytes,
}: {
  path: string;
  limitBytes?: number;
}): Promise<OpenedData> {
  const archive = { name: archiveNamed(basename(path)), body: Bun.file(path) };
  await held({ archive, limitBytes });
  // Nothing to discard: this is the owner's own file, sitting where they left it.
  return { archive, discard: () => Promise.resolve() };
}

/**
 * The folder as one gzipped tarball, written to disk rather than held: the api signs the upload for
 * exactly the length it is told, so the archive has to exist in full before there is a number to
 * declare — and a dataset is the last thing to keep in memory to measure.
 *
 * Packed from inside the folder, so what the archive holds is the folder's *contents*: the root of
 * the archive becomes the root of `data/`, and packing the folder itself would put every file one
 * directory deeper than the app goes looking for it.
 */
async function packedFolder({
  folder,
  ui,
  limitBytes,
}: {
  folder: string;
  ui: Ui;
  limitBytes?: number;
}): Promise<OpenedData> {
  const staging = await mkdtemp(join(tmpdir(), STAGING_PREFIX));
  const name = archiveNamed(`${basename(folder)}${ARCHIVE_SUFFIX}`);
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
    // What it packed to is knowable no earlier than this: compression is what decides it, so no
    // reading of the folder could have said.
    await held({ archive, limitBytes });
    return { archive, discard };
  } catch (failure) {
    await discard();
    throw failure;
  }
}

async function held({
  archive,
  limitBytes,
}: {
  archive: UploadableArchive;
  limitBytes?: number;
}): Promise<void> {
  const refusal = await refusedArchiveBody({ ...archive, ...(limitBytes && { limitBytes }) });
  if (refusal) {
    throw new UsageError(refusal);
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
 * What the upload is called, which is the only name its owner would recognise it by afterwards.
 * Refused rather than repaired where the api would not take it: the folder or the archive is theirs
 * to rename, and a name invented here is one they would not know their own upload by.
 */
function archiveNamed(name: string): Filename {
  try {
    return Value.Parse(FilenameSchema, name);
  } catch {
    throw new UsageError(
      `An app's data is uploaded under the name it has here, and ${name} is not a name nibrun takes: it must start with a letter or digit and hold only letters, digits, dots, dashes or underscores.`,
    );
  }
}
