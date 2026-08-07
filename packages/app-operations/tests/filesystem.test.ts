import { describe, expect, test } from 'bun:test';
import { guestPath } from '#filesystem.ts';

function spelled(typed: string): string {
  return guestPath(typed);
}

describe('a path is absolute because there is nowhere else it could start', () => {
  test('one already spelled that way is left alone', () => {
    expect(spelled('/uploads/2026')).toBe('/uploads/2026');
  });

  test('a leading slash left off is supplied', () => {
    expect(spelled('uploads')).toBe('/uploads');
  });

  test('a trailing slash is spelling too', () => {
    expect(spelled('/uploads/')).toBe('/uploads');
  });

  test('the root survives being trimmed', () => {
    expect(spelled('/')).toBe('/');
  });
});

describe('what is refused rather than repaired', () => {
  // Resolving these is what would let a caller walk out of the filesystem they were scoped to.
  test('a traversal is not resolved', () => {
    expect(() => guestPath('/uploads/../../etc')).toThrow(
      '/uploads/../../etc is not a path inside an app filesystem.',
    );
  });

  test('a quote the reader tooling would tokenise is refused', () => {
    expect(() => guestPath("/it's")).toThrow("/it's is not a path inside an app filesystem.");
  });
});
