import {
  AppConfigSchema,
  AppHostnameSchema,
  AppHostnameStateSchema,
  AppSchema,
  ByteSizeSchema,
  MIN_HOSTNAMES,
  OwnedAppStateSchema,
  REDACTED,
  TenantEnvironmentPatchSchema,
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
// `environment` is an edit rather than a replacement, where `args` is always the whole list. They
// differ because a caller cannot read a secret back to restate it: a variable it says nothing
// about is one it is leaving alone, and removing one is `null`.
export const AppConfigPatchSchema = t.Partial(
  t.Composite([OwnedAppConfigSchema, t.Object({ environment: TenantEnvironmentPatchSchema })]),
  { additionalProperties: false },
);

// An app being created has nothing to leave alone and nothing to remove, so what it is given is
// the whole environment rather than an edit to one.
const NewAppConfigSchema = t.Partial(
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

// What state the app should be in, rather than an instruction to stop or start it: the host is
// never sent either, and reads what it should be running off this. Narrowed to the two an owner
// moves an app between, so a request cannot ask for a deletion or claim one is finished.
export const AppStateRequestSchema = t.Object(
  { state: OwnedAppStateSchema },
  { additionalProperties: false },
);

// A name, not a URL: the hostname is derived from it once and never follows a rename.
export const CreateAppRequestSchema = t.Object(
  {
    name: t.String({ minLength: 1, maxLength: MAX_APP_NAME_LENGTH }),
    config: t.Optional(NewAppConfigSchema),
  },
  { additionalProperties: false },
);
