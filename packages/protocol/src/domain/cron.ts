import { Type } from '@sinclair/typebox';
import { AppIdSchema, DeploymentIdSchema } from '#domain/identifiers.ts';

export const MAX_CRON_JOBS_PER_APP = 10;
export const CRON_TIME_ZONE = 'UTC';

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
});

export type CronTable = typeof CronTableSchema.static;

export const CronTablesSchema = Type.Array(CronTableSchema);
