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
