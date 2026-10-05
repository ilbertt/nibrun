import { TenantEnvironmentSchema } from '@repo/api/domain';
import {
  AppIdSchema,
  DeploymentIdSchema,
  MAX_CRON_JOBS_PER_APP,
  RegisteredCronJobSchema,
  secretString,
} from '@repo/protocol';
import { Type } from '@sinclair/typebox';

export const CronJobDefinitionSchema = Type.Composite([
  Type.Omit(RegisteredCronJobSchema, ['jobId', 'nextRunAt', 'environment']),
  Type.Object({
    environment: Type.Optional({
      ...TenantEnvironmentSchema,
      maxProperties: RegisteredCronJobSchema.properties.environment.maxProperties,
    }),
  }),
]);
export type CronJobDefinition = typeof CronJobDefinitionSchema.static;
export const CronJobDefinitionsSchema = Type.Array(CronJobDefinitionSchema, {
  maxItems: MAX_CRON_JOBS_PER_APP,
});
export type CronJobDefinitions = typeof CronJobDefinitionsSchema.static;

export const MAX_CRONTAB_BYTES = 65_536;

export const CrontabSchema = secretString({
  maxLength: MAX_CRONTAB_BYTES,
  pattern: '^[^\\u0000]*$',
});

export const CronTableSchema = Type.Object({
  appId: AppIdSchema,
  deploymentId: DeploymentIdSchema,
  jobs: CronJobDefinitionsSchema,
  crontab: Type.Optional(CrontabSchema),
});

export type CronTable = typeof CronTableSchema.static;
export const CronTablesSchema = Type.Array(CronTableSchema);
