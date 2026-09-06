import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dataFolderFor, packDataFolder } from '#lib/data-folder.ts';
import { UsageError } from '#lib/errors.ts';
import { uiRecording } from '#tests/support/ui.ts';

const made: string[] = [];

afterEach(async () => {
  await Promise.all(made.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function folderHolding(entries: Record<string, string>): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'nib-test-'));
  made.push(folder);
  for (const [path, content] of Object.entries(entries)) {
    const file = join(folder, path);
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, content);
  }
  return folder;
}

/** What `tar` says is in the archive, which is the end that will be reading it for real. */
async function entriesIn(archive: Blob): Promise<string[]> {
  const listing = Bun.spawn(['tar', '-tz'], { stdin: archive, stdout: 'pipe' });
  const text = await new Response(listing.stdout).text();
  return text.split('\n').filter((line) => line !== '');
}

test('no folder is what a deploy that was given none carries', async () => {
  expect(await dataFolderFor({ path: undefined, app: undefined })).toBeUndefined();
});

/**
 * An app's data is created once, as the app is. Refused here rather than by the api, because what
 * the api refuses is the deployment at the far end of a whole upload.
 */
test('a folder and an app that already exists cannot both be meant', async () => {
  const attempt = dataFolderFor({ path: '/tmp', app: 'quiet-otter' });

  await expect(attempt).rejects.toBeInstanceOf(UsageError);
  await expect(attempt).rejects.toThrow('--app quiet-otter');
});

test('a folder nobody can read costs a line rather than a deploy', async () => {
  await expect(dataFolderFor({ path: './nothing-is-here' })).rejects.toThrow('No such folder');
});

test('a file is not a folder, and is said to be the mistake it is', async () => {
  await expect(dataFolderFor({ path: import.meta.path })).rejects.toThrow('this is a file');
});

// An empty archive is one the host would create the filesystem from and find nothing in, which is
// the filesystem it would have created anyway.
test('an empty folder is nothing to give an app', async () => {
  const folder = await folderHolding({});

  await expect(dataFolderFor({ path: folder })).rejects.toThrow('There is nothing in');
});

/**
 * The archive's root becomes the root of `data/`, so what is packed is the folder's contents and
 * never the folder: an entry `data/pb_data/x.db` would reach the app one directory deeper than it
 * goes looking.
 */
test('the folder contents are the root of the archive, not the folder', async () => {
  const folder = await folderHolding({ 'pb_data/x.db': 'rows', 'notes.txt': 'hello' });

  const packed = await packDataFolder({ folder, ui: uiRecording() });
  const entries = await entriesIn(packed.archive.body);

  expect(entries).toContain('./pb_data/x.db');
  expect(entries).toContain('./notes.txt');
  expect(entries.every((entry) => entry.startsWith('./'))).toBe(true);
  await packed.discard();
});

// The url is signed for exactly the length that was declared, and the length declared is this one.
test('the archive is a file on disk, and is gone once it has been sent', async () => {
  const folder = await folderHolding({ 'notes.txt': 'hello' });

  const packed = await packDataFolder({ folder, ui: uiRecording() });
  const written = (packed.archive.body as Bun.BunFile).name ?? '';

  expect(packed.archive.body.size).toBeGreaterThan(0);
  expect(packed.archive.name).toEndWith('.tar.gz');

  await packed.discard();
  // Asked again rather than of the same handle: a `BunFile` answers from the stat it already took.
  expect(await Bun.file(written).exists()).toBe(false);
});

/**
 * `uploadImport` refuses the same archive, but only once an app has been created and a binary
 * uploaded against it — so a folder that packs past the cap has to be answered here, before any of
 * that. What it packs to is knowable no earlier: compression is what decides it.
 */
test('a folder that packs past the cap is refused before an app is created', async () => {
  const folder = await folderHolding({ 'notes.txt': 'hello' });
  const packing = packDataFolder({ folder, ui: uiRecording(), limitBytes: 1 });

  await expect(packing).rejects.toThrow('at most');
});

test('and the archive it packed does not stay on the machine', async () => {
  const folder = await folderHolding({ 'notes.txt': 'hello' });
  const staging = await stagingDirectories();

  await packDataFolder({ folder, ui: uiRecording(), limitBytes: 1 }).catch(() => undefined);

  expect(await stagingDirectories()).toEqual(staging);
});

/** The temporary directories `packDataFolder` makes, so a leaked one is visible as a new name. */
async function stagingDirectories(): Promise<string[]> {
  const entries = await readdir(tmpdir());
  return entries.filter((entry) => entry.startsWith('nib-data-')).sort();
}
