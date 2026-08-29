import { expect, test } from 'bun:test';
import { Sha256DigestSchema, Value } from '@repo/protocol';
import { binaryFrom } from '#lib/deploy.ts';
import { UsageError } from '#lib/errors.ts';

const URL_SOURCE = 'https://releases.test/v1/my-server';
const CHECKSUM = Value.Parse(
  Sha256DigestSchema,
  'd9403d88cdf0684fbb9d8e97cf3508e9fb4506cf309a34e42653a1c2bc04a298',
);

/**
 * A url is handed on rather than opened: this machine is not the end that fetches it, so nothing
 * here can say whether it answers — only the api can, and it is asked in the same breath as the
 * deploy.
 */
test('an https url is a binary for the api to fetch', async () => {
  expect(await binaryFrom({ source: URL_SOURCE })).toEqual({ url: URL_SOURCE, sha256: undefined });
});

test('a url the api would not be alone on the wire for is named as the mistake it is', async () => {
  await expect(binaryFrom({ source: 'http://releases.test/v1/my-server' })).rejects.toBeInstanceOf(
    UsageError,
  );
});

/**
 * Sent as the api reads it, and refused here where it could never be one: what the checksum would
 * have caught is at the far end of a whole transfer, so a mistyped one is worth a line now.
 */
test('a checksum travels with the url, in the spelling the api takes', async () => {
  expect(await binaryFrom({ source: URL_SOURCE, sha256: ` ${CHECKSUM.toUpperCase()} ` })).toEqual({
    url: URL_SOURCE,
    sha256: CHECKSUM,
  });
  await expect(binaryFrom({ source: URL_SOURCE, sha256: 'nope' })).rejects.toThrow('64 hex');
});

test('anything that is not a url is a file on this machine', async () => {
  const binary = await binaryFrom({ source: import.meta.path });

  expect(binary).toMatchObject({ name: 'deploy.test.ts' });
});

// Refused rather than dropped: a deploy that went ahead without checking the checksum it was
// given is the one outcome giving one has to rule out.
test('and a checksum is not something a file on this machine is deployed with', async () => {
  await expect(binaryFrom({ source: import.meta.path, sha256: CHECKSUM })).rejects.toThrow(
    '--sha256',
  );
});

test('a file nobody can read costs a line rather than a deploy', async () => {
  await expect(binaryFrom({ source: './nothing-is-here' })).rejects.toThrow('No such file');
});
