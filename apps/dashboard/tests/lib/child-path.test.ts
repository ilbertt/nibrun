import { expect, test } from 'bun:test';
import { childPath } from '#lib/child-path.ts';

test('matches connected file paths at the volume root and in nested directories', () => {
  expect(childPath({ path: '/', name: 'database.sqlite' })).toBe('/database.sqlite');
  expect(childPath({ path: 'data/', name: 'database.sqlite' })).toBe('/data/database.sqlite');
  expect(childPath({ path: '/other', name: 'database.sqlite' })).toBe('/other/database.sqlite');
});
