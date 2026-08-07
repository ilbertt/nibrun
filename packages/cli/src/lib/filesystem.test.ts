import { describe, expect, test } from 'bun:test';
import type { FilesystemEntry } from '@repo/protocol';
import { UsageError } from '#lib/errors.ts';
import { render, typedPath } from '#lib/filesystem.ts';

function entry(overrides: Partial<FilesystemEntry> = {}): FilesystemEntry {
  return {
    name: 'app.db',
    kind: 'file',
    sizeBytes: 1258,
    modifiedAt: '2026-08-06T09:41:00.123Z',
    ...overrides,
  } as FilesystemEntry;
}

function spelled(typed: string): string {
  return typedPath(typed);
}

describe('a path the filesystem cannot take is something that was typed wrong', () => {
  test('one it can take is handed on as it stands', () => {
    expect(spelled('uploads/')).toBe('/uploads');
  });

  test('one it cannot is refused in the words `nib` refuses anything else in', () => {
    expect(() => typedPath('/uploads/../../etc')).toThrow(UsageError);
    expect(() => typedPath('/uploads/../../etc')).toThrow(
      '/uploads/../../etc is not a path inside an app filesystem.',
    );
  });
});

describe('a listing is read down a column', () => {
  test('entries are sorted by name rather than left in directory order', () => {
    const lines = render([entry({ name: 'zeta' }), entry({ name: 'alpha' })]);

    expect(lines.map((line) => line.split(' ').at(-1))).toEqual(['alpha', 'zeta']);
  });

  test('sizes line up under each other', () => {
    const lines = render([
      entry({ name: 'a', sizeBytes: 7 }),
      entry({ name: 'b', sizeBytes: 4096 }),
    ]);

    expect(lines).toEqual([
      'file         7 2026-08-06 09:41 a',
      'file      4096 2026-08-06 09:41 b',
    ]);
  });

  test('a kind wider than the one beside it does not shift the columns', () => {
    const lines = render([entry({ name: 'uploads', kind: 'directory', sizeBytes: 4096 })]);

    expect(lines).toEqual(['directory 4096 2026-08-06 09:41 uploads']);
  });

  // The tenant's binary made this name, so it has to survive being described rather than break
  // the layout of everything after it.
  test('a name the tenant chose is the last thing on the line', () => {
    const lines = render([entry({ name: 'two\nlines' })]);

    expect(lines).toEqual(['file      1258 2026-08-06 09:41 two\nlines']);
  });
});
