import { describe, expect, test } from 'bun:test';
import { describeUnreadableFilesystem, guestPath } from '#filesystem.ts';

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

describe('a filesystem nothing is mounting is said to be, rather than asked after', () => {
  test("a failed release accounts for itself in the host's own words", () => {
    expect(
      describeUnreadableFilesystem({
        id: 'dep-1',
        state: 'failed',
        message: 'nothing answered on port 4991 inside the guest.',
      }),
    ).toBe('Deployment dep-1 is failed. nothing answered on port 4991 inside the guest.');
  });

  test('a release that is serving is nothing to say', () => {
    expect(describeUnreadableFilesystem({ id: 'dep-1', state: 'active' })).toBeUndefined();
  });

  // The wait is worth it while a release is still coming up, and a stopped one belongs to a
  // suspended app, which is an owner's own doing and reads as such where they did it.
  test('nor is one still on its way up, or one an owner stopped', () => {
    expect(describeUnreadableFilesystem({ id: 'dep-1', state: 'starting' })).toBeUndefined();
    expect(describeUnreadableFilesystem({ id: 'dep-1', state: 'stopped' })).toBeUndefined();
  });
});
