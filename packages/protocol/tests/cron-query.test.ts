import { describe, expect, test } from 'bun:test';
import {
  CRON_TIME_ZONE,
  CronListingSchema,
  CronQueryRequestSchema,
  CronQueryResultSchema,
  CronQuerySchema,
  isValidMessage,
  MAX_CRON_JOBS_PER_APP,
} from '#index.ts';

const DEPLOYMENT = { appId: 'app-1', deploymentId: 'deployment-1' };
const JOB = { jobId: 'job-1', schedule: '*/5 * * * *', command: 'echo hello' };
const LISTING = { ...DEPLOYMENT, enabled: true, timeZone: CRON_TIME_ZONE, jobs: [JOB] };
const EXCESSIVE_MESSAGE_LENGTH = 513;

describe('cron queries', () => {
  test('both routing and results require deployment identity', () => {
    expect(
      isValidMessage({ schema: CronQuerySchema, value: { ...DEPLOYMENT, queryId: 'q-1' } }),
    ).toBe(true);
    expect(
      isValidMessage({
        schema: CronQuerySchema,
        value: { appId: DEPLOYMENT.appId, queryId: 'q-1' },
      }),
    ).toBe(false);
    expect(
      isValidMessage({
        schema: CronQueryRequestSchema,
        value: { servedDeployments: [DEPLOYMENT] },
      }),
    ).toBe(true);
    expect(
      isValidMessage({
        schema: CronQueryRequestSchema,
        value: { servedDeployments: [{ appId: DEPLOYMENT.appId }] },
      }),
    ).toBe(false);
  });

  test('suspended and empty registrations remain valid listings', () => {
    expect(
      isValidMessage({ schema: CronListingSchema, value: { ...LISTING, enabled: false } }),
    ).toBe(true);
    expect(isValidMessage({ schema: CronListingSchema, value: { ...LISTING, jobs: [] } })).toBe(
      true,
    );
  });

  test('listing limits and job identity match the registration contract', () => {
    expect(
      isValidMessage({
        schema: CronListingSchema,
        value: { ...LISTING, jobs: Array.from({ length: MAX_CRON_JOBS_PER_APP }, () => JOB) },
      }),
    ).toBe(true);
    expect(
      isValidMessage({
        schema: CronListingSchema,
        value: { ...LISTING, jobs: Array.from({ length: MAX_CRON_JOBS_PER_APP + 1 }, () => JOB) },
      }),
    ).toBe(false);
    expect(
      isValidMessage({
        schema: CronListingSchema,
        value: { ...LISTING, jobs: [{ schedule: JOB.schedule, command: JOB.command }] },
      }),
    ).toBe(false);
    expect(
      isValidMessage({ schema: CronListingSchema, value: { ...LISTING, timeZone: 'local' } }),
    ).toBe(false);
  });

  test('a failed read is an explicit bounded answer', () => {
    expect(
      isValidMessage({
        schema: CronQueryResultSchema,
        value: {
          queryId: 'q-1',
          outcome: { status: 'failed', message: 'Deployment unavailable.' },
        },
      }),
    ).toBe(true);
    expect(
      isValidMessage({
        schema: CronQueryResultSchema,
        value: {
          queryId: 'q-1',
          outcome: { status: 'failed', message: 'x'.repeat(EXCESSIVE_MESSAGE_LENGTH) },
        },
      }),
    ).toBe(false);
  });
});
