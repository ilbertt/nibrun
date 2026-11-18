import { httpsUrl, stringEnum } from '@repo/typebox-extensions';
import { Type } from '@sinclair/typebox';

const strict = { additionalProperties: false } as const;

export const JwtAccessPolicySchema = Type.Object(
  {
    kind: Type.Literal('jwt'),
    token: Type.Object(
      {
        header: Type.String({
          minLength: 1,
          maxLength: 256,
          pattern: "^[!#$%&'*+.^_`|~0-9A-Za-z-]+$",
        }),
        format: stringEnum(['raw', 'bearer'] as const),
      },
      strict,
    ),
    issuer: Type.String({ minLength: 1, maxLength: 2048, pattern: '\\S' }),
    audiences: Type.Array(Type.String({ minLength: 1, maxLength: 2048, pattern: '\\S' }), {
      minItems: 1,
      maxItems: 32,
      uniqueItems: true,
    }),
    publicKeys: Type.Union([
      Type.Array(Type.String({ minLength: 1, maxLength: 16384 }), { minItems: 1, maxItems: 8 }),
      Type.Object({ url: httpsUrl({ maxLength: 2048 }) }, strict),
    ]),
  },
  strict,
);

export const AppAccessPolicySchema = Type.Union([
  Type.Object({ kind: Type.Literal('public') }, strict),
  JwtAccessPolicySchema,
]);

export type AppAccessPolicy = typeof AppAccessPolicySchema.static;
