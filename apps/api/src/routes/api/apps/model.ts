import {
  AppConfigSchema,
  AppHostnameSchema,
  ByteSizeSchema,
  ComputeUsageSchema,
  FilesystemUsageSchema,
  TimestampSchema,
} from '@repo/protocol';
import { t } from 'elysia';
import {
  AppHostnameStateSchema,
  AppNameSchema,
  AppSchema,
  MIN_HOSTNAMES,
  NewAppConfigSchema,
} from '#lib/api/app.ts';
import { REDACTED } from '#lib/redact-secrets.ts';

// Which variables are set, never what they hold: the values are sealed in the database and only
// opened on their way to the host, so there is nothing here that could return one.
const RedactedEnvironmentSchema = t.Record(t.String(), t.Literal(REDACTED), {
  description: 'The variables this app runs with. Values are never returned.',
});

export const PublicAppConfigSchema = t.Object({
  ...AppConfigSchema.properties,
  environment: RedactedEnvironmentSchema,
  volumeSizeBytes: ByteSizeSchema,
});

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
