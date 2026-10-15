import { expect, test } from 'bun:test';
import { CimdMetadataRepository } from '#repositories/cimd-metadata.repository.ts';

test.each(['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.0.2.1'])(
  'the native CIMD transport rejects special-use address %s',
  async (address) => {
    const repository = new CimdMetadataRepository();
    await expect(
      repository.fetch({ input: `https://${address}/client.json`, init: undefined }),
    ).rejects.toThrow('public-routable');
  },
);

test('the native CIMD transport refuses HTTP', async () => {
  const repository = new CimdMetadataRepository();
  await expect(
    repository.fetch({ input: 'http://client.example/client.json', init: undefined }),
  ).rejects.toThrow('HTTPS');
});

test.each(['POST', 'PUT', 'DELETE'])(
  'the native CIMD transport refuses %s before resolving the hostname',
  async (method) => {
    const repository = new CimdMetadataRepository();
    await expect(
      repository.fetch({ input: 'https://client.invalid/client.json', init: { method } }),
    ).rejects.toThrow('GET and HEAD');
  },
);
