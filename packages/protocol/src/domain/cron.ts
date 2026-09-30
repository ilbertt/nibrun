import { Type } from '@sinclair/typebox';
import { TenantEnvironmentSchema } from '#domain/app.ts';
import { AppIdSchema, DeploymentIdSchema } from '#domain/identifiers.ts';
import { secretString } from '#lib/secret.ts';

export const MAX_CRON_JOBS_PER_APP = 10;
export const CRON_TIME_ZONE = 'UTC';
export const MAX_CRONTAB_BYTES = 65_536;
export const MAX_CRON_ENVIRONMENT_VARIABLES = 256;

export const CrontabSchema = secretString({
  maxLength: MAX_CRONTAB_BYTES,
  pattern: '^[^\\u0000]*$',
});

const MAX_CRON_SCHEDULE_LENGTH = 256;
const MAX_CRON_COMMAND_LENGTH = 4096;
const NONEMPTY_LINE_PATTERN = '^(?![ \\t]*$)[^\\u0000\\r\\n]+$';

// Bun validates expression syntax in the agent; the shared protocol has no runtime dependency.
export const CronScheduleSchema = Type.String({
  minLength: 1,
  maxLength: MAX_CRON_SCHEDULE_LENGTH,
  pattern: NONEMPTY_LINE_PATTERN,
});

export const CronCommandSchema = Type.String({
  minLength: 1,
  maxLength: MAX_CRON_COMMAND_LENGTH,
  pattern: NONEMPTY_LINE_PATTERN,
});

export const CronJobDefinitionSchema = Type.Object({
  schedule: CronScheduleSchema,
  command: CronCommandSchema,
  environment: Type.Optional({
    ...TenantEnvironmentSchema,
    maxProperties: MAX_CRON_ENVIRONMENT_VARIABLES,
  }),
});

export type CronJobDefinition = typeof CronJobDefinitionSchema.static;

export const CronJobDefinitionsSchema = Type.Array(CronJobDefinitionSchema, {
  maxItems: MAX_CRON_JOBS_PER_APP,
});

export type CronJobDefinitions = typeof CronJobDefinitionsSchema.static;

export const CronTableSchema = Type.Object({
  appId: AppIdSchema,
  deploymentId: DeploymentIdSchema,
  jobs: CronJobDefinitionsSchema,
  crontab: Type.Optional(CrontabSchema),
});

export type CronTable = typeof CronTableSchema.static;

export const CronTablesSchema = Type.Array(CronTableSchema);
