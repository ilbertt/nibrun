import { expect, test } from 'bun:test';
import { Value } from '@sinclair/typebox/value';
import { OwnerIdSchema } from '#lib/api/identifiers.ts';
import { ForbiddenError } from '#lib/errors.ts';
import { jwksRelayUrl } from '#lib/jwks-relay.ts';
import { RemoteFetchSlots } from '#lib/remote-fetch.ts';
import { JwksService } from '#services/jwks.service.ts';
import { TEST_SECRETS_KEY } from '#tests/support/secrets.ts';

test('only an issued key source can be fetched and only public key material is returned', async () => {
  const ownerId = Value.Parse(OwnerIdSchema, 'owner');
  const source = 'https://identity.example/keys';
  const url = new URL(
    jwksRelayUrl({
      ownerId,
      source,
      key: TEST_SECRETS_KEY,
      origin: new URL('https://api.example'),
    }),
  );
  const signature = url.searchParams.get('signature') ?? '';
  const opened: string[] = [];
  const publicRsa = { kid: 'current', kty: 'RSA' as const, n: 'public-modulus', e: 'AQAB' };
  const service = new JwksService({
    key: TEST_SECRETS_KEY,
    slots: new RemoteFetchSlots(),
    sources: {
      open({ url }) {
        opened.push(url);
        const json = {
          keys: [
            { ...publicRsa, d: 'private' },
            { kid: 'sym', kty: 'oct', k: 'secret' },
          ],
        };
        return Promise.resolve({
          outcome: 'open',
          body: new Blob([JSON.stringify(json)]).stream(),
          declaredSizeBytes: undefined,
        });
      },
    },
  });
  await expect(
    service.read({ ownerId, source: 'https://other.example/', signature }),
  ).rejects.toThrow(ForbiddenError);
  expect(opened).toEqual([]);
  expect(await service.read({ ownerId, source, signature })).toEqual({ keys: [publicRsa] });
  expect(opened).toEqual([source]);
});
