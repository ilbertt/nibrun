import { expect, test } from 'bun:test';
import { binaryFrom } from '#lib/deploy.ts';
import { UsageError } from '#lib/errors.ts';

const URL_SOURCE = 'https://releases.test/v1/my-server';

/**
 * A url is handed on rather than opened: this machine is not the end that fetches it, so nothing
 * here can say whether it answers — only the api can, and it is asked in the same breath as the
 * deploy.
 */
test('an https url is a binary for the api to fetch', async () => {
  expect(await binaryFrom(URL_SOURCE)).toEqual({ url: URL_SOURCE });
});

test('a url the api would not be alone on the wire for is named as the mistake it is', async () => {
  await expect(binaryFrom('http://releases.test/v1/my-server')).rejects.toBeInstanceOf(UsageError);
});

test('anything that is not a url is a file on this machine', async () => {
  const binary = await binaryFrom(import.meta.path);

  expect(binary).toMatchObject({ name: 'deploy.test.ts' });
});

test('a file nobody can read costs a line rather than a deploy', async () => {
  await expect(binaryFrom('./nothing-is-here')).rejects.toThrow('No such file');
});
