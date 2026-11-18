import { type Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { OwnerId } from '#lib/api/identifiers.ts';
import { boundedTo } from '#lib/artifact-digest.ts';
import { BadGatewayError, ForbiddenError } from '#lib/errors.ts';
import { acceptsKeySource } from '#lib/jwks-relay.ts';
import type { RemoteFetchSlots } from '#lib/remote-fetch.ts';
import type { TenantSecretsKey } from '#lib/tenant-secrets.ts';
import type { RemoteSourceRepositoryContract } from '#repositories/remote-source.repository.ts';
import { Service } from '#services/service.ts';

const MAX_KEY_SET_BYTES = 262_144;
const keyMetadata = Type.Object({
  kid: Type.String({ minLength: 1 }),
  alg: Type.Optional(Type.String()),
  use: Type.Optional(Type.String()),
  key_ops: Type.Optional(Type.Array(Type.String())),
});
const publicKey = Type.Union([
  Type.Composite([
    keyMetadata,
    Type.Object({ kty: Type.Literal('RSA'), n: Type.String(), e: Type.String() }),
  ]),
  Type.Composite([
    keyMetadata,
    Type.Object({
      kty: Type.Literal('EC'),
      crv: Type.String(),
      x: Type.String(),
      y: Type.String(),
    }),
  ]),
  Type.Composite([
    keyMetadata,
    Type.Object({ kty: Type.Literal('OKP'), crv: Type.String(), x: Type.String() }),
  ]),
]);
const keySet = Type.Object({ keys: Type.Array(Type.Unknown(), { maxItems: 32 }) });

export class JwksService extends Service {
  constructor(
    private readonly dependencies: {
      sources: RemoteSourceRepositoryContract;
      slots: RemoteFetchSlots;
      key: TenantSecretsKey;
    },
  ) {
    super();
  }

  async read(input: { source: string; ownerId: OwnerId; signature: string }) {
    const { key, slots, sources } = this.dependencies;
    if (!acceptsKeySource({ ...input, key, binding: input.signature })) {
      throw new ForbiddenError();
    }
    slots.take(input.ownerId);
    try {
      const result = await sources.open({ url: input.source });
      if (result.outcome !== 'open') {
        throw new BadGatewayError('The signing keys could not be fetched.');
      }
      const stream = boundedTo({ source: result.body, maxSizeBytes: MAX_KEY_SET_BYTES });
      const document: unknown = await new Response(stream).json();
      Value.Assert(keySet, document);
      const keys: Static<typeof publicKey>[] = [];
      for (const candidate of document.keys) {
        if (Value.Check(publicKey, candidate)) {
          keys.push(Value.Parse(publicKey, candidate));
        }
      }
      return { keys };
    } catch {
      throw new BadGatewayError('The signing keys could not be read.');
    } finally {
      slots.release(input.ownerId);
    }
  }
}
