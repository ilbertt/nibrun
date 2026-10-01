import {
  AppIdSchema,
  CRON_TIME_ZONE,
  CronJobIdSchema,
  type CronListing,
  DeploymentIdSchema,
  Value,
} from '@repo/protocol';

export const CRON_DEPLOYMENT = {
  appId: Value.Parse(AppIdSchema, 'app-1'),
  deploymentId: Value.Parse(DeploymentIdSchema, 'deployment-1'),
};

export const CRON_LISTING: CronListing = {
  ...CRON_DEPLOYMENT,
  enabled: true,
  timeZone: CRON_TIME_ZONE,
  jobs: [
    { jobId: Value.Parse(CronJobIdSchema, 'job-1'), schedule: '* * * * *', command: 'echo hello' },
  ],
};
