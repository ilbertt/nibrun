import { expect, test } from 'bun:test';
import { deployHref } from '#href.ts';

const ORIGIN = 'https://nibrun.test';

test('a link with nothing to prefill is the deploy screen itself', () => {
  expect(deployHref({ origin: ORIGIN, link: {} })).toBe(`${ORIGIN}/deploy`);
});

/**
 * The spelling matters more than it looks: the screen parses its search with `JSON.parse`, so a
 * port written as `"3000"` arrives there as a string and fails the field it lands in.
 */
test('a port is written as the number the deploy screen reads back', () => {
  expect(deployHref({ origin: ORIGIN, link: { port: 3000 } })).toContain('port=3000');
});

test('every argument survives as its own occurrence', () => {
  const href = deployHref({ origin: ORIGIN, link: { arg: ['serve', '--port=8080'] } });

  expect(decodeURIComponent(href)).toContain('arg=["serve","--port=8080"]');
});

test('a name with spaces in it is escaped rather than left to split the query', () => {
  const href = deployHref({ origin: ORIGIN, link: { name: 'my server' } });

  expect(href).not.toContain('my server');
  expect(new URL(href).searchParams.get('name')).toBe('my server');
});
