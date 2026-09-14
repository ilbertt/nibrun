import { expect, test } from 'bun:test';
import { ApiError, ApiRefusal, failureOf, unwrap } from '#unwrap.ts';

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

  expect(failureOf(failure).message).toBe('The api answered 404: Not Found');
});

test('a refusal keeps the body the api answered with, whole', () => {
  const body = { error: 'This account can have 3 apps.', appsAllowed: 3 };
  const failure = Object.assign(new Error('[object Object]'), { status: 403, value: body });

  const refusal = failureOf(failure);

  expect(refusal).toBeInstanceOf(ApiRefusal);
  expect((refusal as ApiRefusal).body).toEqual(body);
});

test('a body that names no error is still worth repeating', () => {
  const failure = Object.assign(new Error('nope'), { status: 500, value: 'nope' });

  expect(failureOf(failure).message).toBe('The api answered 500: nope');
});

// Eden reports a request it never sent as a 503 of its own, and saying the api answered it would
// blame a server that was never reached.
test('an api that could not be reached is not one that answered', () => {
  const failure = Object.assign(new Error('unreachable'), {
    status: 503,
    value: new TypeError('Unable to connect'),
  });

  const failed = failureOf(failure);

  expect(failed.message).toBe('Unable to connect');
  expect(failed).not.toBeInstanceOf(ApiRefusal);
});
