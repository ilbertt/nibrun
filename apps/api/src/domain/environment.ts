import {
  SecretStringSchema,
  TenantEnvironmentSchema as WireTenantEnvironmentSchema,
} from '@repo/protocol';
import { Type } from '@sinclair/typebox';
import { TENANT_VALUE_PATTERN } from '#domain/runtime-values.ts';

const TenantValueSchema = { ...SecretStringSchema, pattern: TENANT_VALUE_PATTERN };
const EnvironmentNameSchema = Type.String({
  pattern: Object.keys(WireTenantEnvironmentSchema.patternProperties)[0],
});
export const TenantEnvironmentSchema = Type.Record(EnvironmentNameSchema, TenantValueSchema, {
  additionalProperties: false,
});
export type TenantEnvironment = typeof TenantEnvironmentSchema.static;
export const TenantEnvironmentPatchSchema = Type.Record(
  EnvironmentNameSchema,
  Type.Union([TenantValueSchema, Type.Null()]),
  { additionalProperties: false },
);
export type TenantEnvironmentPatch = typeof TenantEnvironmentPatchSchema.static;
