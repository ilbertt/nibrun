import { describe, expect, test } from 'bun:test';
import { MAX_CRON_ENVIRONMENT_VARIABLES, MAX_CRON_JOBS_PER_APP } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Effect, Either } from 'effect';
import { parseCrontab } from '#lib/cron/crontab.ts';
import { CrontabSchema, MAX_CRONTAB_BYTES } from '#lib/cron/model.ts';
import { OBSERVED_AT, tenantEnvironment } from '#tests/support/fixtures.ts';
import { runScoped } from '#tests/support/run.ts';

function parsing(text: string) {
  return runScoped(Effect.either(parseCrontab({ text, after: OBSERVED_AT })));
}

describe('tenant crontabs', () => {
  test('comments and environment lines do not consume the ten-job budget', async () => {
    const text = [
      '# cleanup',
      'TOKEN="a secret"',
      '',
      ...Array.from(
        { length: MAX_CRON_JOBS_PER_APP },
        () => '@hourly /mnt/artifact/server cleanup',
      ),
    ].join('\n');
    const result = await parsing(text);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.crontab).toBe(Value.Parse(CrontabSchema, text));
      expect(result.right.jobs).toHaveLength(MAX_CRON_JOBS_PER_APP);
      expect(result.right.jobs[0]?.environment).toEqual(tenantEnvironment({ TOKEN: 'a secret' }));
    }
  });

  test('each command captures the assignments above it without expanding values', async () => {
    const result = await parsing(
      'TOKEN=" $TOKEN # literal "\n@hourly first\nTOKEN=next\n0 1 * January Monday second',
    );
    expect(Either.isRight(result) && result.right.jobs).toEqual([
      {
        schedule: '@hourly',
        command: 'first',
        environment: tenantEnvironment({ TOKEN: ' $TOKEN # literal ' }),
      },
      {
        schedule: '0 1 * January Monday',
        command: 'second',
        environment: tenantEnvironment({ TOKEN: 'next' }),
      },
    ]);
  });

  test('shell commands, percent signs, tabs, and trailing spaces survive parsing', async () => {
    const command = 'printf "%s" "a b" && /mnt/artifact/server cleanup  ';
    const result = await parsing(`\t*/5\t* * * *\t${command}\r\n`);
    expect(Either.isRight(result) && result.right.jobs).toEqual([
      { schedule: '*/5\t* * * *', command, environment: {} },
    ]);
  });

  test('an empty or comment-only table removes all jobs', async () => {
    for (const text of ['', '# empty\n\t\n', 'TOKEN=unused\n']) {
      const result = await parsing(text);
      expect(Either.isRight(result) && result.right.jobs).toEqual([]);
    }
  });

  test.each([
    '@reboot secret-command',
    '@hourly',
    '0 * * * missing-field',
    '0 0 30 2 * secret-command',
    'TOKEN="tenant-secret\n@hourly command',
    'TOKEN=tenant-secret\u0000\n@hourly command',
    '__proto__=tenant-secret\n@hourly command',
    'CRON_TZ=Europe/Zurich\n@hourly command',
    Array.from({ length: MAX_CRON_JOBS_PER_APP + 1 }, () => '@hourly secret-command').join('\n'),
    `${Array.from(Array(MAX_CRON_ENVIRONMENT_VARIABLES + 1).keys(), (index) => `V${index}=value`).join('\n')}\n@hourly command`,
    '#'.repeat(MAX_CRONTAB_BYTES + 1),
    `#${'é'.repeat(MAX_CRONTAB_BYTES / 2)}`,
  ])('rejects an invalid table without exposing its contents', async (text) => {
    const result = await parsing(text);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(JSON.stringify(result.left)).not.toContain('secret-command');
      expect(JSON.stringify(result.left)).not.toContain('tenant-secret');
    }
  });
});
