import { expect, test } from 'bun:test';
import {
  CRON_TIME_ZONE,
  type CronListing,
  type RegisteredCronJob,
  SecretStringSchema,
  Value,
} from '@repo/protocol';
import { renderToStaticMarkup } from 'react-dom/server';
import { CronSchedules } from '#components/crons/cron-schedules.tsx';

const FIRST_JOB = {
  jobId: 'cron-1',
  schedule: '*/5 * * * *',
  command: './app cleanup',
} as RegisteredCronJob;

const LISTING = {
  appId: 'app-1',
  deploymentId: 'deployment-1',
  enabled: true,
  timeZone: CRON_TIME_ZONE,
  jobs: [FIRST_JOB, { jobId: 'cron-2', schedule: '@daily', command: './app cleanup' }],
} as CronListing;

test('suspended schedules stay visible while execution is disabled', () => {
  const markup = renderToStaticMarkup(<CronSchedules listing={{ ...LISTING, enabled: false }} />);
  expect(markup).toContain('UTC');
  expect(markup).toContain('*/5 * * * *');
  expect(markup).toContain('@daily');
  expect(markup).toContain('cron-1');
  expect(markup).toContain('cron-2');
});

test('an empty table reports no registrations independently of execution status', () => {
  const markup = renderToStaticMarkup(<CronSchedules listing={{ ...LISTING, jobs: [] }} />);
  expect(markup).toContain('No cron jobs registered');
  expect(markup).not.toContain('<table');
});

test('tenant commands are escaped and environment values stay out of the page', () => {
  const job = {
    ...FIRST_JOB,
    command: 'echo "<script>alert(1)</script>"',
    environment: { TOKEN: Value.Parse(SecretStringSchema, 'secret') },
  };
  const markup = renderToStaticMarkup(<CronSchedules listing={{ ...LISTING, jobs: [job] }} />);
  expect(markup).toContain('&lt;script&gt;');
  expect(markup).not.toContain('<script>');
  expect(markup).not.toContain('secret');
});
