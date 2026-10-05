import {
  ByteSizeSchema,
  HttpPortSchema,
  InstanceResourcesSchema,
  stringEnum,
} from '@repo/protocol';
import { t } from 'elysia';
import { RUNTIME_VALUE_NAMES } from '#lib/runtime-values.ts';

export const ConfigurationResponseSchema = t.Object({
  appDefaults: t.Object({
    httpPort: HttpPortSchema,
    resources: InstanceResourcesSchema,
    volumeSizeBytes: ByteSizeSchema,
  }),
  runtimeValues: t.Array(
    t.Object({
      name: stringEnum(RUNTIME_VALUE_NAMES),
      description: t.String(),
      requiresExtraPublicPort: t.Boolean(),
    }),
  ),
});
