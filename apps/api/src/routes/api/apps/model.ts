import {
  AppConfigSchema,
  AppHostnameSchema,
  AppHostnameStateSchema,
  AppSchema,
  ByteSizeSchema,
  MIN_HOSTNAMES,
  REDACTED,
  TenantEnvironmentSchema,
} from '@repo/protocol';
import { t } from 'elysia';

const MAX_APP_NAME_LENGTH = 128;

// `environment` is written and read in different shapes, so it is taken out here and each half
// says its own.
const OwnedAppConfigSchema = t.Omit(AppConfigSchema, ['environment']);

// Which variables are set, never what they hold: the values are sealed in the database and only
// opened on their way to the host, so there is nothing here that could return one.
const RedactedEnvironmentSchema = t.Record(t.String(), t.Literal(REDACTED), {
  description: 'The variables this app runs with. Values are never returned.',
});

// The api sizes an app's filesystem, so the size is read back but never set. It is added on
// top of what an owner owns rather than omitted from it, which is what keeps it out of the
// patch shape below without naming it twice.
export const PublicAppConfigSchema = t.Composite([
  OwnedAppConfigSchema,
  t.Object({ volumeSizeBytes: ByteSizeSchema, environment: RedactedEnvironmentSchema }),
]);

// Strict: every field is optional, so without this a misspelled one is silently no request at
// all and the caller is told 200.
//
// Omitting `environment` leaves the one already stored alone, where omitting `args` replaces it
// with none. They differ because a caller cannot read a secret back to restate it, so treating
// silence as "none" would be how a deploy erases one nobody meant to touch.
export const AppConfigPatchSchema = t.Partial(
  t.Composite([OwnedAppConfigSchema, t.Object({ environment: TenantEnvironmentSchema })]),
  { additionalProperties: false },
);

/**
 * What a host is told about a hostname, plus the two things only its owner needs: whether the
 * edge can serve it yet, and the record to place so that it can.
 *
 * Here rather than under `hostnames/` because the app response below carries it too, and a
 * schema shared by sibling routes belongs to the folder above them.
 */
export const AppHostnameResponseSchema = t.Composite([
  AppHostnameSchema,
  t.Object({
    state: AppHostnameStateSchema,
    // Absent on a platform hostname, which the wildcard certificate already covers, and until
    // the edge has answered with a target for a custom one.
    dcvTarget: t.Nullable(t.String()),
  }),
]);

// `hostnames` is widened the same way `config` is: what an owner is shown carries the state,
// which a host is never sent. `minItems` is restated from the schema it replaces rather than
// left off — an app always has the hostname nibrun issued it.
export const AppResponseSchema = t.Composite([
  t.Omit(AppSchema, ['config', 'hostnames']),
  t.Object({
    config: PublicAppConfigSchema,
    hostnames: t.Array(AppHostnameResponseSchema, { minItems: MIN_HOSTNAMES }),
  }),
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
