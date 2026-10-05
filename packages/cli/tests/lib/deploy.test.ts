import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { binaryFrom } from '#lib/deploy.ts';
import { UsageError } from '#lib/errors.ts';

const URL_SOURCE = 'https://releases.test/v1/my-server';
const CHECKSUM = 'd9403d88cdf0684fbb9d8e97cf3508e9fb4506cf309a34e42653a1c2bc04a298';

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

test('a local binary carries the digest of its bytes for upload reuse', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nib-binary-'));
  const source = join(directory, 'my-server');
  try {
    await Bun.write(source, 'abc');
    expect(await binaryFrom({ source })).toMatchObject({
      name: 'my-server',
      digest: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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
