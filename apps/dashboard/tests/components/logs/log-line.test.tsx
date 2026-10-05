import { expect, test } from 'bun:test';
import type { TenantLogRecord } from '@repo/protocol/control/tenant-log';
import { CronJobIdSchema } from '@repo/protocol/schemas/identifiers';
import { Value } from '@sinclair/typebox/value';
import { renderToStaticMarkup } from 'react-dom/server';
import { LogLine } from '#components/logs/log-line.tsx';

const CRON_JOB_ID = Value.Parse(
  CronJobIdSchema,
  'cron-CsKypu7sYgXAb0WuIMJpywy_3HFUTFH88qBtbZ5RS_E',
);

function record(overrides: Partial<TenantLogRecord> = {}): TenantLogRecord {
  return {
    _time: '2026-10-01T09:00:00.000Z',
    _msg: 'cleanup complete\n',
    stream: 'stdout',
    sourceId: 'source-1',
    sequence: 1,
    ...overrides,
  } as TenantLogRecord;
}

test('cron log rows place a details trigger after the output and keep the ID hidden', () => {
  const markup = renderToStaticMarkup(
    <LogLine record={record({ cronJobId: CRON_JOB_ID })} cronSchedule="*/5 * * * *" />,
  );
  expect(markup).not.toContain(CRON_JOB_ID);
  expect(markup).toContain('aria-label="Cron job details"');
  expect(markup.indexOf('cleanup complete')).toBeLessThan(markup.indexOf('Cron job details'));
  expect(markup).toContain('cleanup complete');
  expect(markup).toContain('out');
});

test('server log rows carry no cron label', () => {
  const markup = renderToStaticMarkup(<LogLine record={record()} cronSchedule={undefined} />);
  expect(markup).not.toContain('Cron job details');
  expect(markup).not.toContain(CRON_JOB_ID);
  expect(markup).toContain('cleanup complete');
});

test('cron metadata preserves stderr labels and escapes tenant output', () => {
  const markup = renderToStaticMarkup(
    <LogLine
      record={record({
        cronJobId: CRON_JOB_ID,
        stream: 'stderr',
        _msg: '<script>alert(1)</script>',
      })}
      cronSchedule={undefined}
    />,
  );
  expect(markup).toContain('Cron job details');
  expect(markup).toContain('err');
  expect(markup).toContain('text-destructive');
  expect(markup).toContain('&lt;script&gt;');
  expect(markup).not.toContain('<script>');
});
