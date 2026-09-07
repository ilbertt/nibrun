import { expect, test } from 'bun:test';
import { sameOriginPath } from '#lib/same-origin-path.ts';

test('a path of its own is where the visitor came from', () => {
  expect(sameOriginPath('/')).toBe('/');
  expect(sameOriginPath('/apps')).toBe('/apps');
  expect(sameOriginPath('/apps?tab=logs')).toBe('/apps?tab=logs');
  expect(sameOriginPath('/evil.example')).toBe('/evil.example');
});

test('a scheme of any kind is refused, even one that would point back here', () => {
  expect(sameOriginPath('https://evil.example/phish')).toBeUndefined();
  expect(sameOriginPath('http://localhost:3000/apps')).toBeUndefined();
  expect(sameOriginPath('javascript:alert(1)')).toBeUndefined();
});

test('a leading slash is not enough once what follows hands the browser a host', () => {
  expect(sameOriginPath('//evil.example')).toBeUndefined();
  expect(sameOriginPath('/\\evil.example')).toBeUndefined();
  expect(sameOriginPath('\\\\evil.example')).toBeUndefined();
});

// The parser drops them before it reads, so a path carrying one is read as something else.
test('a tab or a newline inside it is refused rather than dropped and read again', () => {
  expect(sameOriginPath('/\t/evil.example')).toBeUndefined();
  expect(sameOriginPath('/\n/evil.example')).toBeUndefined();
  expect(sameOriginPath('/apps /evil.example')).toBeUndefined();
});

test('nothing to come back to is left for the caller to decide', () => {
  expect(sameOriginPath(undefined)).toBeUndefined();
  expect(sameOriginPath(['/apps'])).toBeUndefined();
});
