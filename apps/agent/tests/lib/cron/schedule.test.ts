import { describe, expect, test } from 'bun:test';
import { MAX_CRON_JOBS_PER_APP, TimestampSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Effect } from 'effect';
import type { CronJobDefinition } from '#lib/cron/model.ts';
import { nextCronRun, validateCronJobs } from '#lib/cron/schedule.ts';
import { runScoped } from '#tests/support/run.ts';

const AFTER = Value.Parse(TimestampSchema, '2026-09-30T09:41:56.000Z');

function job(schedule: string): CronJobDefinition {
  return { schedule, command: '/mnt/artifact/server cleanup' };
}

function next(schedule: string) {
  return runScoped(nextCronRun({ schedule, after: AFTER }));
}

describe('Bun cron expressions', () => {
  const examples = [
    { schedule: '* * * * *', expected: '2026-09-30T09:42:00.000Z' },
    { schedule: '*/15 * * * *', expected: '2026-09-30T09:45:00.000Z' },
    { schedule: '1,15 * * * *', expected: '2026-09-30T10:01:00.000Z' },
    { schedule: '9-17 * * * *', expected: '2026-09-30T10:09:00.000Z' },
    { schedule: '0,30 9-17 * * *', expected: '2026-09-30T10:00:00.000Z' },
    { schedule: '0 9 * * MON-FRI', expected: '2026-10-01T09:00:00.000Z' },
    { schedule: '0 9 * * Monday-Friday', expected: '2026-10-01T09:00:00.000Z' },
    { schedule: '0 0 1 JAN,JUN *', expected: '2027-01-01T00:00:00.000Z' },
    { schedule: '0 0 1 January *', expected: '2027-01-01T00:00:00.000Z' },
    { schedule: '0 0 1 january *', expected: '2027-01-01T00:00:00.000Z' },
    { schedule: '0 0 * * 0', expected: '2026-10-04T00:00:00.000Z' },
    { schedule: '0 0 * * 7', expected: '2026-10-04T00:00:00.000Z' },
    { schedule: '@yearly', expected: '2027-01-01T00:00:00.000Z' },
    { schedule: '@annually', expected: '2027-01-01T00:00:00.000Z' },
    { schedule: '@monthly', expected: '2026-10-01T00:00:00.000Z' },
    { schedule: '@weekly', expected: '2026-10-04T00:00:00.000Z' },
    { schedule: '@daily', expected: '2026-10-01T00:00:00.000Z' },
    { schedule: '@midnight', expected: '2026-10-01T00:00:00.000Z' },
    { schedule: '@hourly', expected: '2026-09-30T10:00:00.000Z' },
  ];

  for (const { schedule, expected } of examples) {
    test(schedule, async () => {
      expect<string>(await next(schedule)).toBe(expected);
    });
  }

  test('restricted day fields match either day', async () => {
    expect<string>(await next('0 0 15 * FRI')).toBe('2026-10-02T00:00:00.000Z');
    expect<string>(
      await runScoped(
        nextCronRun({
          schedule: '0 0 15 * FRI',
          after: Value.Parse(TimestampSchema, '2026-10-14T00:00:00.000Z'),
        }),
      ),
    ).toBe('2026-10-15T00:00:00.000Z');
  });

  test('the next occurrence is strictly after the previous one', async () => {
    const first = await next('*/15 * * * *');
    expect<string>(await runScoped(nextCronRun({ schedule: '*/15 * * * *', after: first }))).toBe(
      '2026-09-30T10:00:00.000Z',
    );
  });

  test('a leap-day schedule advances to the next leap year', async () => {
    expect<string>(await next('0 0 29 2 *')).toBe('2028-02-29T00:00:00.000Z');
  });

  test('calculating from the current instant skips past occurrences', async () => {
    expect<string>(await next('0 9 * * *')).toBe('2026-10-01T09:00:00.000Z');
  });

  test('UTC is explicit even when the reference instant has another offset', async () => {
    expect<string>(
      await runScoped(
        nextCronRun({
          schedule: '0 9 * * *',
          after: Value.Parse(TimestampSchema, '2026-09-30T09:41:56.000+02:00'),
        }),
      ),
    ).toBe('2026-09-30T09:00:00.000Z');
  });

  test('invalid syntax produces a typed failure without echoing tenant input', async () => {
    for (const schedule of ['60 * * * *', '* * * *', '* * * * * *', '@reboot', 'tenant-secret']) {
      const error = await runScoped(Effect.flip(nextCronRun({ schedule, after: AFTER })));

      expect(error._tag).toBe('InvalidCronSchedule');
      expect(error.reason).toBe('invalid-expression');
      expect(error.message).not.toContain(schedule);
    }
  });

  test('a well-formed expression with no occurrence is refused', async () => {
    const error = await runScoped(
      Effect.flip(nextCronRun({ schedule: '0 0 30 2 *', after: AFTER })),
    );

    expect(error._tag).toBe('InvalidCronSchedule');
    expect(error.reason).toBe('no-future-occurrence');
  });
});

describe('cron table validation', () => {
  test('ten schedules are validated without rewriting commands or expressions', async () => {
    const jobs = Array.from({ length: MAX_CRON_JOBS_PER_APP }, () => job('@daily'));

    expect(await runScoped(validateCronJobs({ jobs, after: AFTER }))).toEqual(jobs);
  });

  test('an empty replacement is valid', async () => {
    expect(await runScoped(validateCronJobs({ jobs: [], after: AFTER }))).toEqual([]);
  });

  test('too many schedules fail at the protocol boundary', async () => {
    const jobs = Array.from({ length: MAX_CRON_JOBS_PER_APP + 1 }, () => job('@daily'));
    const error = await runScoped(Effect.flip(validateCronJobs({ jobs, after: AFTER })));

    expect(error._tag).toBe('ProtocolMismatch');
  });

  test('one bad expression fails validation of the whole replacement', async () => {
    const jobs = [job('@hourly'), job('invalid'), job('@daily')];
    const original = structuredClone(jobs);
    const error = await runScoped(Effect.flip(validateCronJobs({ jobs, after: AFTER })));

    expect(error._tag).toBe('InvalidCronSchedule');
    expect(jobs).toEqual(original);
  });

  test('a malformed command fails without exposing its content', async () => {
    const command = 'tenant-secret\u0000';
    const jobs = [{ ...job('@daily'), command }];
    const error = await runScoped(Effect.flip(validateCronJobs({ jobs, after: AFTER })));

    expect(error._tag).toBe('ProtocolMismatch');
    expect(error.message).not.toContain(command);
    expect(JSON.stringify(error)).not.toContain(command);
  });
});
