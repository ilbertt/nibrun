import { Type } from '@sinclair/typebox';
import { TimestampSchema } from '#lib/wire.ts';
import { TenantEnvironmentSchema } from '#schemas/app.ts';
import { AppIdSchema, CronJobIdSchema, DeploymentIdSchema } from '#schemas/identifiers.ts';

export const MAX_CRON_JOBS_PER_APP = 10;
export const CRON_TIME_ZONE = 'UTC';
export const MAX_CRON_ENVIRONMENT_VARIABLES = 256;
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

export const RegisteredCronJobSchema = Type.Object({
  jobId: CronJobIdSchema,
  schedule: CronScheduleSchema,
  command: CronCommandSchema,
  environment: Type.Optional({
    ...TenantEnvironmentSchema,
    maxProperties: MAX_CRON_ENVIRONMENT_VARIABLES,
  }),
  nextRunAt: Type.Optional(TimestampSchema),
});

export type RegisteredCronJob = typeof RegisteredCronJobSchema.static;

export const CronListingSchema = Type.Composite([
  Type.Object({ appId: AppIdSchema, deploymentId: DeploymentIdSchema }),
  Type.Object({
    enabled: Type.Boolean(),
    timeZone: Type.Literal(CRON_TIME_ZONE),
    jobs: Type.Array(RegisteredCronJobSchema, { maxItems: MAX_CRON_JOBS_PER_APP }),
  }),
]);

export type CronListing = typeof CronListingSchema.static;
