import { Kind, OptionalKind, ReadonlyKind, type TSchema } from '@sinclair/typebox';
import * as app from '../../../apps/api/src/lib/api/app.ts';
import { DEPLOYMENT_STATES } from '../../../apps/api/src/lib/api/deployment.ts';
import {
  DEFAULT_LOG_TIMERANGE,
  LOG_TIMERANGE_PATTERN,
} from '../../../apps/api/src/lib/api/log-query.ts';
import * as defaults from '../../../apps/api/src/lib/app-config-defaults.ts';
import {
  CNAME_RECORD_TYPE,
  requiredDomainDnsRecords,
} from '../../../apps/api/src/lib/dns-records.ts';
import { REDACTED } from '../../../apps/api/src/lib/redact-secrets.ts';
import { RUNTIME_VALUES } from '../../../apps/api/src/lib/runtime-values.ts';
import { ReadDirectoryQuerySchema } from '../../../apps/api/src/routes/api/apps/[appId]/deployments/[deploymentId]/filesystem/model.ts';
import { DomainDnsQuerySchema } from '../../../apps/api/src/routes/api/apps/[appId]/hostnames/dns/model.ts';
import { CreateImportBodySchema } from '../../../apps/api/src/routes/api/apps/[appId]/imports/model.ts';
import {
  AppPatchSchema,
  CreateAppRequestSchema,
} from '../../../apps/api/src/routes/api/apps/model.ts';
import { TenantLogRecordSchema } from '../../../packages/protocol/src/control/tenant-log.ts';
import * as wire from '../../../packages/protocol/src/lib/wire.ts';
import {
  IdleTimeoutMsSchema,
  TenantEnvironmentSchema,
} from '../../../packages/protocol/src/schemas/app.ts';
import * as cron from '../../../packages/protocol/src/schemas/cron.ts';
import * as filesystem from '../../../packages/protocol/src/schemas/filesystem.ts';
import * as identifiers from '../../../packages/protocol/src/schemas/identifiers.ts';
import { INSTANCE_STATES } from '../../../packages/protocol/src/schemas/instance.ts';

const schemas = {
  AppNameSchema: { schema: CreateAppRequestSchema.properties.name, type: "App['name']" },
  HttpPortSchema: { schema: AppPatchSchema.properties.httpPort, type: "App['config']['httpPort']" },
  TenantEnvironmentPatchSchema: {
    schema: AppPatchSchema.properties.environment,
    type: 'TenantEnvironmentPatch',
  },
  FilenameSchema: { schema: CreateImportBodySchema.properties.filename, type: 'Filename' },
  HostnameSchema: {
    schema: DomainDnsQuerySchema.properties.hostname,
    type: "App['hostnames'][number]['hostname']",
  },
  GuestPathSchema: { schema: ReadDirectoryQuerySchema.properties.path, type: 'GuestPath' },
  Sha256DigestSchema: { schema: wire.Sha256DigestSchema, type: 'Sha256Digest' },
  TimestampSchema: { schema: wire.TimestampSchema, type: "App['createdAt']" },
  AppIdSchema: { schema: identifiers.AppIdSchema, type: "App['id']" },
  CronJobIdSchema: {
    schema: identifiers.CronJobIdSchema,
    type: "CronListing['jobs'][number]['jobId']",
  },
  SecretStringSchema: {
    schema: Object.values(TenantEnvironmentSchema.patternProperties)[0]!,
    type: 'string',
  },
};

const values = {
  APP_STATES: app.APP_STATES,
  APP_ACTIVATIONS: app.APP_ACTIVATIONS,
  APP_HOSTNAME_STATES: app.APP_HOSTNAME_STATES,
  APP_HOSTNAME_KINDS: Object.values(
    app.AppSchema.properties.hostnames.items.properties.kind.anyOf,
  ).map((schema) => schema.const),
  DEPLOYMENT_STATES,
  INSTANCE_STATES,
  TENANT_LOG_STREAMS: TenantLogRecordSchema.properties.stream.anyOf.map((schema) => schema.const),
  FILESYSTEM_ENTRY_KINDS: filesystem.FilesystemEntrySchema.properties.kind.anyOf.map(
    (schema) => schema.const,
  ),
  DEFAULT_HTTP_PORT: defaults.DEFAULT_HTTP_PORT,
  DEFAULT_VOLUME_SIZE_BYTES: defaults.DEFAULT_VOLUME_SIZE_BYTES,
  DEFAULT_INSTANCE_RESOURCES: defaults.DEFAULT_INSTANCE_RESOURCES,
  DEFAULT_LOG_TIMERANGE,
  LOG_TIMERANGE_PATTERN,
  RUNTIME_VALUES,
  TENANT_VALUE_PATTERN: Object.values(TenantEnvironmentSchema.patternProperties)[0]!.pattern,
  REDACTED,
  CNAME_RECORD_TYPE,
  DOMAIN_DNS_RECORD_TEMPLATES: {
    routing: requiredDomainDnsRecords({
      hostname: '{hostname}',
      routingTarget: '{routingTarget}',
      dcvTarget: undefined,
    }),
    withCertificate: requiredDomainDnsRecords({
      hostname: '{hostname}',
      routingTarget: '{routingTarget}',
      dcvTarget: '{dcvTarget}',
    }),
  },
  MIN_IDLE_TIMEOUT_MS: IdleTimeoutMsSchema.minimum,
  MAX_IDLE_TIMEOUT_MS: IdleTimeoutMsSchema.maximum,
  DIRECTORY_ENTRY_LIMIT: filesystem.DirectoryListingSchema.properties.entries.maxItems,
  CRON_TIME_ZONE: cron.CronListingSchema.properties.timeZone.const,
};

function schemaJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(schemaJson);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const properties = Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, schemaJson(entry)]),
  );
  if (Kind in value) {
    const schema = value as TSchema;
    return {
      ...properties,
      __kind: schema[Kind],
      __optional: schema[OptionalKind],
      __readonly: schema[ReadonlyKind],
    };
  }
  return properties;
}

function schemaSource(schema: TSchema): string {
  return JSON.stringify(schemaJson(schema))
    .replace(/"__kind":/g, '[Kind]:')
    .replace(/"__optional":/g, '[OptionalKind]:')
    .replace(/"__readonly":/g, '[ReadonlyKind]:');
}

const file = new URL('../src/public-contract.gen.ts', import.meta.url);
const source = [
  '// Generated by scripts/generate-public-contract.ts; API definitions are the source of truth.',
  "import { Kind, OptionalKind, Type } from '@sinclair/typebox';",
  "import type { App, CronListing, Filename, GuestPath, Sha256Digest, TenantEnvironmentPatch } from '#models.ts';",
  ...Object.entries(schemas).map(
    ([name, { schema, type }]) =>
      `export const ${name} = Type.Unsafe<${type}>(${schemaSource(schema)});`,
  ),
  ...Object.entries(values).map(
    ([name, value]) => `export const ${name} = ${JSON.stringify(value)} as const;`,
  ),
].join('\n');
const formatted = Bun.spawn(
  ['bun', 'run', '--bun', 'biome', 'check', '--write', '--stdin-file-path', file.pathname],
  {
    stdin: new Blob([source]),
    stdout: 'pipe',
    stderr: 'inherit',
  },
);
const output = await new Response(formatted.stdout).text();
if ((await formatted.exited) !== 0) {
  throw new Error('Could not format public contract');
}
if (process.argv.includes('--check')) {
  if (!(await Bun.file(file).exists()) || (await Bun.file(file).text()) !== output) {
    throw new Error(
      'Public contract is stale. Run bun run generate:contract in packages/api-client.',
    );
  }
} else {
  await Bun.write(file, output);
}
