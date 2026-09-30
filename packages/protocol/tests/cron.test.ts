import { describe, expect, test } from 'bun:test';
import {
  CronCommandSchema,
  type CronJobDefinition,
  CronJobDefinitionsSchema,
  CronScheduleSchema,
  isValidMessage,
  MAX_CRON_JOBS_PER_APP,
  parseMessage,
} from '#index.ts';

const JOB: CronJobDefinition = {
  schedule: '*/5 * * * *',
  command: '/mnt/artifact/server cleanup',
};

function accepts(jobs: unknown) {
  return isValidMessage({ schema: CronJobDefinitionsSchema, value: jobs });
}

describe('cron definitions', () => {
  test('ten entries fit and an eleventh rejects the whole table', () => {
    expect(accepts(Array.from({ length: MAX_CRON_JOBS_PER_APP }, () => JOB))).toBe(true);
    expect(accepts(Array.from({ length: MAX_CRON_JOBS_PER_APP + 1 }, () => JOB))).toBe(false);
  });

  test('an empty table can remove all schedules', () => {
    expect(accepts([])).toBe(true);
  });

  test('every entry needs a schedule and a command', () => {
    expect(accepts([{ schedule: JOB.schedule }])).toBe(false);
    expect(accepts([{ command: JOB.command }])).toBe(false);
    expect(accepts([null])).toBe(false);
    expect(accepts({ jobs: [JOB] })).toBe(false);
  });

  test('empty or multiline fields are refused before interpretation', () => {
    for (const value of ['', ' ', '\t', 'a\nb', 'a\rb', 'a\u0000b']) {
      expect(accepts([{ ...JOB, schedule: value }])).toBe(false);
      expect(accepts([{ ...JOB, command: value }])).toBe(false);
    }
  });

  test('field lengths are bounded', () => {
    expect(accepts([{ ...JOB, schedule: 'x'.repeat(CronScheduleSchema.maxLength! + 1) }])).toBe(
      false,
    );
    expect(accepts([{ ...JOB, command: 'x'.repeat(CronCommandSchema.maxLength! + 1) }])).toBe(
      false,
    );
  });

  test('shell syntax is carried verbatim', () => {
    const command = '/mnt/artifact/server cleanup && printf "%s" "a b" >> data/result # done';
    const jobs = [{ ...JOB, command }];

    expect(parseMessage({ schema: CronJobDefinitionsSchema, value: jobs })).toEqual(jobs);
  });

  test('additional fields are tolerated during a rollout', () => {
    expect(accepts([{ ...JOB, futureField: true }])).toBe(true);
  });
});
