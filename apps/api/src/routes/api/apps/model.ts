import {
  AppConfigSchema,
  AppHostnameSchema,
  AppHostnameStateSchema,
  AppNameSchema,
  AppSchema,
  ByteSizeSchema,
  ComputeUsageSchema,
  FilesystemUsageSchema,
  MIN_HOSTNAMES,
  REDACTED,
  TenantEnvironmentPatchSchema,
  TenantEnvironmentSchema,
  TimestampSchema,
} from '@repo/protocol';
import { t } from 'elysia';

// Which variables are set, never what they hold: the values are sealed in the database and only
// opened on their way to the host, so there is nothing here that could return one.
const RedactedEnvironmentSchema = t.Record(t.String(), t.Literal(REDACTED), {
  description: 'The variables this app runs with. Values are never returned.',
});

// Everything an app runs with, plus the filesystem the api sized for it. `environment` is written
// and read in different shapes, so it is taken out and each half says its own.
export const PublicAppConfigSchema = t.Composite([
  t.Omit(AppConfigSchema, ['environment']),
  t.Object({ volumeSizeBytes: ByteSizeSchema, environment: RedactedEnvironmentSchema }),
]);

// How the binary is started, which is the whole of what an owner chooses. The machine it starts
// on — vCPUs, memory, filesystem, health probe, restart budget — is nibrun's, and naming the two
// that are not is what turns a request for the rest into an answer rather than silence.
const OwnedAppConfigSchema = t.Pick(AppConfigSchema, ['httpPort', 'hasExtraPublicPort', 'args']);

// Strict: every field is optional, so without this a misspelled one is silently no request at
// all and the caller is told 200.
//
// `environment` is an edit rather than a replacement, where `args` is always the whole list. They
// differ because a caller cannot read a secret back to restate it: a variable it says nothing
// about is one it is leaving alone, and removing one is `null`.
//
// `name` is the one field here that is not config: a rename changes what the owner calls the
// app and nothing about how it starts, so the hostname minted from the first name stays.
export const AppPatchSchema = t.Partial(
  t.Composite([
    OwnedAppConfigSchema,
    t.Object({ environment: TenantEnvironmentPatchSchema, name: AppNameSchema }),
  ]),
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
    // In the edge's own words, because they name the record still missing. Empty once nothing is,
    // and while the edge has not been asked yet.
    edgeErrors: t.Array(t.String()),
    // When the owner asked for it — which for a waiting domain is how long it has been waiting.
    createdAt: TimestampSchema,
  }),
]);

// `hostnames` is widened the same way `config` is: what an owner is shown carries the state,
// which a host is never sent. `minItems` is restated from the schema it replaces rather than
// left off — an app always has the hostname nibrun issued it.
//
// `volumeUsage` is nullable rather than optional: an app that has never been measured is a
// different thing from a field a client should go looking for, and the two read the same once a
// key is simply missing. `expiresAt` for the same reason — most apps are kept, and a client
// deciding whether to show a deadline should be told there is none rather than left to infer it.
export const AppResponseSchema = t.Composite([
  t.Omit(AppSchema, ['config', 'hostnames']),
  t.Object({
    config: PublicAppConfigSchema,
    hostnames: t.Array(AppHostnameResponseSchema, { minItems: MIN_HOSTNAMES }),
    volumeUsage: t.Nullable(FilesystemUsageSchema),
    computeUsage: t.Nullable(ComputeUsageSchema),
    expiresAt: t.Nullable(TimestampSchema, {
      description: 'When this app will be deleted, or null when it is kept until its owner does.',
    }),
  }),
]);

export const ListAppsResponseSchema = t.Object({ apps: t.Array(AppResponseSchema) });

// A name, not a URL: the hostname is derived from it once and never follows a rename.
export const CreateAppRequestSchema = t.Object(
  {
    name: AppNameSchema,
    config: t.Optional(NewAppConfigSchema),
  },
  { additionalProperties: false },
);
