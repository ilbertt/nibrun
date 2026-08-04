import { AppConfigSchema, AppSchema, ByteSizeSchema } from '@repo/protocol';
import { t } from 'elysia';

const MAX_APP_NAME_LENGTH = 128;

// Secrets storage is deferred, so `environment` is neither accepted nor returned.
const OwnedAppConfigSchema = t.Omit(AppConfigSchema, ['environment']);

// The api sizes an app's filesystem, so the size is read back but never set. It is added on
// top of what an owner owns rather than omitted from it, which is what keeps it out of the
// patch shape below without naming it twice.
export const PublicAppConfigSchema = t.Composite([
  OwnedAppConfigSchema,
  t.Object({ volumeSizeBytes: ByteSizeSchema }),
]);

// Strict: every field is optional, so without this a misspelled one is silently no request at
// all and the caller is told 200.
export const AppConfigPatchSchema = t.Partial(OwnedAppConfigSchema, {
  additionalProperties: false,
});

export const AppResponseSchema = t.Composite([
  t.Omit(AppSchema, ['config']),
  t.Object({ config: PublicAppConfigSchema }),
]);

export const ListAppsResponseSchema = t.Object({ apps: t.Array(AppResponseSchema) });

// A name, not a URL: the hostname is derived from it once and never follows a rename.
export const CreateAppRequestSchema = t.Object(
  {
    name: t.String({ minLength: 1, maxLength: MAX_APP_NAME_LENGTH }),
    config: t.Optional(AppConfigPatchSchema),
  },
  { additionalProperties: false },
);
