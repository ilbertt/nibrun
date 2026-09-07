import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsageError } from '#lib/errors.ts';
import { type InitialData, initialDataFrom, openInitialData } from '#lib/initial-data.ts';
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

function folder(path: string): InitialData {
  return { kind: 'folder', path };
}

function opening(path: string) {
  return openInitialData({ data: { kind: 'archive', path }, ui: uiRecording() });
}

test('no folder is what a deploy that was given none carries', async () => {
  expect(await initialDataFrom({ path: undefined, app: undefined })).toBeUndefined();
});

/**
 * An app's data is created once, as the app is. Refused here rather than by the api, because what
 * the api refuses is the deployment at the far end of a whole upload.
 */
test('a folder and an app that already exists cannot both be meant', async () => {
  const attempt = initialDataFrom({ path: '/tmp', app: 'quiet-otter' });

  await expect(attempt).rejects.toBeInstanceOf(UsageError);
  await expect(attempt).rejects.toThrow('--app quiet-otter');
});

test('a path nobody can read costs a line rather than a deploy', async () => {
  await expect(initialDataFrom({ path: './nothing-is-here' })).rejects.toThrow(
    'No such folder or archive',
  );
});

// An empty archive is one the host would create the filesystem from and find nothing in, which is
// the filesystem it would have created anyway.
test('an empty folder is nothing to give an app', async () => {
  const empty = await folderHolding({});

  await expect(initialDataFrom({ path: empty })).rejects.toThrow('There is nothing in');
});

/**
 * The archive's root becomes the root of `data/`, so what is packed is the folder's contents and
 * never the folder: an entry `data/pb_data/x.db` would reach the app one directory deeper than it
 * goes looking.
 */
test('the folder contents are the root of the archive, not the folder', async () => {
  const source = await folderHolding({ 'pb_data/x.db': 'rows', 'notes.txt': 'hello' });

  const opened = await openInitialData({ data: folder(source), ui: uiRecording() });
  const entries = await entriesIn(opened.archive.body);

  expect(entries).toContain('./pb_data/x.db');
  expect(entries).toContain('./notes.txt');
  expect(entries.every((entry) => entry.startsWith('./'))).toBe(true);
  await opened.discard();
});

// The url is signed for exactly the length that was declared, and the length declared is this one.
test('what a folder packed to is a file on disk, and is gone once it has been sent', async () => {
  const source = await folderHolding({ 'notes.txt': 'hello' });

  const opened = await openInitialData({ data: folder(source), ui: uiRecording() });
  const written = (opened.archive.body as Bun.BunFile).name ?? '';

  expect(opened.archive.body.size).toBeGreaterThan(0);
  expect(opened.archive.name).toEndWith('.tar.gz');

  await opened.discard();
  // Asked again rather than of the same handle: a `BunFile` answers from the stat it already took.
  expect(await Bun.file(written).exists()).toBe(false);
});

/**
 * `uploadImport` refuses the same archive, but only once an app has been created and a binary
 * uploaded against it — so a folder that packs past the cap has to be answered here, before any of
 * that. What it packs to is knowable no earlier: compression is what decides it.
 */
test('a folder that packs past the cap is refused before an app is created', async () => {
  const source = await folderHolding({ 'notes.txt': 'hello' });
  const packing = openInitialData({ data: folder(source), ui: uiRecording(), limitBytes: 1 });

  await expect(packing).rejects.toThrow('at most');
});

test('and the archive it packed does not stay on the machine', async () => {
  const source = await folderHolding({ 'notes.txt': 'hello' });
  const staging = await stagingDirectories();

  await openInitialData({ data: folder(source), ui: uiRecording(), limitBytes: 1 }).catch(
    () => undefined,
  );

  expect(await stagingDirectories()).toEqual(staging);
});

/** The temporary directories a packed folder makes, so a leaked one is visible as a new name. */
async function stagingDirectories(): Promise<string[]> {
  const entries = await readdir(tmpdir());
  return entries.filter((entry) => entry.startsWith('nib-data-')).sort();
}

/**
 * An owner who already has an archive — the one a desktop archiver made, or the one they were sent
 * — has nothing to gain from this unpacking it to pack it again, and a dataset to lose the time of.
 */
test('an archive the owner already has is one they can name', async () => {
  const source = await folderHolding({ 'pb_data/x.db': 'rows' });
  const path = join(source, '..', 'given.tar.gz');
  await Bun.$`tar czf ${path} -C ${source} .`.quiet();
  made.push(path);

  const data = await initialDataFrom({ path });

  expect(data).toEqual({ kind: 'archive', path });
});

test('and it is sent as it stands rather than packed again', async () => {
  const source = await folderHolding({ 'pb_data/x.db': 'rows' });
  const path = join(source, '..', 'given.tar.gz');
  await Bun.$`tar czf ${path} -C ${source} .`.quiet();
  made.push(path);

  const opened = await opening(path);

  expect((opened.archive.body as Bun.BunFile).name).toBe(path);
  expect(opened.archive.name).toBe('given.tar.gz');
});

/** It is the owner's own file, sitting where they left it: a release ending is no reason to lose it. */
test('and discarding it does not delete it', async () => {
  const source = await folderHolding({ 'pb_data/x.db': 'rows' });
  const path = join(source, '..', 'given.tar.gz');
  await Bun.$`tar czf ${path} -C ${source} .`.quiet();
  made.push(path);

  const opened = await opening(path);
  await opened.discard();

  expect(await Bun.file(path).exists()).toBe(true);
});

test('a zip is one of the two an app may be created from', async () => {
  const source = await folderHolding({ 'pb_data/x.db': 'rows' });
  const path = join(source, '..', 'given.zip');
  await Bun.$`zip -q -r ${path} .`.cwd(source).quiet();
  made.push(path);

  const opened = await opening(path);

  expect(opened.archive.name).toBe('given.zip');
});

/**
 * Refused before the app is created, for the reason a packed folder is: the api reads the object
 * rather than the request, so anything else is a whole upload spent to be told no.
 */
test('a file that is neither is refused before an app is created', async () => {
  const source = await folderHolding({ 'notes.txt': 'hello' });
  const path = join(source, 'notes.txt');

  await expect(opening(path)).rejects.toThrow('is not a .tar.gz or a .zip');
});

test('an archive named something the api would refuse costs a line rather than the upload', async () => {
  const source = await folderHolding({ 'pb_data/x.db': 'rows' });
  const path = join(source, '..', 'my data.tar.gz');
  await Bun.$`tar czf ${path} -C ${source} .`.quiet();
  made.push(path);

  await expect(opening(path)).rejects.toThrow('is not a name nibrun takes');
});
