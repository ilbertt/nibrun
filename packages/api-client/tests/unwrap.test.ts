import { expect, test } from 'bun:test';
import { ApiError, describeFailure, unwrap } from '#unwrap.ts';

test('a reply that carries no failure is the data it carries', () => {
  expect(unwrap({ data: { apps: [] }, error: null })).toEqual({ apps: [] });
});

test('a failure Eden handed back rather than threw is raised here', () => {
  const failure = Object.assign(new Error('[object Object]'), {
    status: 404,
    value: { error: 'Not Found' },
  });

  expect(() => unwrap({ data: null, error: failure })).toThrow(ApiError);
});

test('a refusal is reported as the api answering, not as this program deciding', () => {
  const failure = Object.assign(new Error('[object Object]'), {
    status: 404,
    value: { error: 'Not Found' },
  });

  expect(describeFailure(failure)).toBe('The api answered 404: Not Found');
});

test('a body that names no error is still worth repeating', () => {
  const failure = Object.assign(new Error('nope'), { status: 500, value: 'nope' });

  expect(describeFailure(failure)).toBe('The api answered 500: nope');
});

// Eden reports a request it never sent as a 503 of its own, and saying the api answered it would
// blame a server that was never reached.
test('an api that could not be reached is not one that answered', () => {
  const failure = Object.assign(new Error('unreachable'), {
    status: 503,
    value: new TypeError('Unable to connect'),
  });

  expect(describeFailure(failure)).toBe('Unable to connect');
});

test.each([
  '<!DOCTYPE html>\n<html><head><title>Bad gateway</title></head><body>Proxy error</body></html>',
  '\n  <!doctype HTML PUBLIC "-//W3C//DTD HTML 4.01//EN">\n<html>Proxy error</html>',
  '\uFEFF<HTML lang="en"><body>Proxy error</body></HTML>',
])('an HTML error page is summarized without printing its markup: %s', (page) => {
  const failure = { status: 502, value: page };

  expect(describeFailure(failure)).toBe(
    'The api answered 502: an error page instead of an API response',
  );
});

test('markup inside an API error remains the API message', () => {
  const failure = { status: 400, value: { error: '<html> is not an accepted value' } };

  expect(describeFailure(failure)).toBe('The api answered 400: <html> is not an accepted value');
});

test('plain text mentioning markup is not mistaken for an HTML page', () => {
  const failure = { status: 400, value: 'Expected <html> at the start of the document' };

  expect(describeFailure(failure)).toBe(
    'The api answered 400: Expected <html> at the start of the document',
  );
});

test('a streamed error body is summarized without consuming it', () => {
  let consumed = false;

  async function* errorPage() {
    consumed = true;
    yield await Promise.resolve('<!DOCTYPE html><html>Proxy error</html>');
  }

  const failure = { status: 504, value: errorPage() };

  expect(describeFailure(failure)).toBe(
    'The api answered 504: an error page instead of an API response',
  );
  expect(consumed).toBe(false);
});
