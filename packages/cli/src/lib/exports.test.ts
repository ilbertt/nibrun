import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundlePath } from '#lib/exports.ts';

const SLUG = 'quiet-otter';

let root = '';

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'nib-export-'));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('where the bundle lands', () => {
  test('a directory is somewhere to put it, so the app names it', async () => {
    await expect(bundlePath({ destination: root, slug: SLUG })).resolves.toBe(
      join(root, `${SLUG}.tar.gz`),
    );
  });

  test('anything else is the name itself', async () => {
    const named = join(root, 'yesterday.tar.gz');

    await expect(bundlePath({ destination: named, slug: SLUG })).resolves.toBe(named);
  });

  // A name is what the caller wanted it called, and a suffix they left off is one they left off.
  test('a name without the suffix keeps the name it was given', async () => {
    const named = join(root, 'yesterday');

    await expect(bundlePath({ destination: named, slug: SLUG })).resolves.toBe(named);
  });

  test('a directory that does not exist is said before anything is asked for', async () => {
    const missing = join(root, 'nowhere', 'bundle.tar.gz');

    await expect(bundlePath({ destination: missing, slug: SLUG })).rejects.toThrow(
      `No such directory: ${join(root, 'nowhere')}.`,
    );
  });
});

describe('an export is a moment rather than an update', () => {
  test('a file already there is not written over', async () => {
    const taken = join(root, 'taken.tar.gz');
    await Bun.write(taken, 'an earlier export');

    await expect(bundlePath({ destination: taken, slug: SLUG })).rejects.toThrow(
      `${taken} already exists.`,
    );
  });

  test('a directory already holding this app export is not written over either', async () => {
    const directory = await mkdtemp(join(root, 'exports-'));
    await Bun.write(join(directory, `${SLUG}.tar.gz`), 'an earlier export');

    await expect(bundlePath({ destination: directory, slug: SLUG })).rejects.toThrow(
      `${join(directory, `${SLUG}.tar.gz`)} already exists.`,
    );
  });
});
