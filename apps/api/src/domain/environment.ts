import { TenantEnvironmentSchema } from '@repo/protocol';
import { Type } from '@sinclair/typebox';

export const TenantEnvironmentPatchSchema = Type.Record(
  Type.String({ pattern: Object.keys(TenantEnvironmentSchema.patternProperties)[0] }),
  Type.Union([Object.values(TenantEnvironmentSchema.patternProperties)[0]!, Type.Null()]),
  { additionalProperties: false },
);
export type TenantEnvironmentPatch = typeof TenantEnvironmentPatchSchema.static;
