import { expect, test } from 'bun:test';
import { CronJobIdSchema, type TenantLogRecord, Value } from '@repo/protocol';
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

test('cron log rows expose the full job ID beside their output', () => {
  const markup = renderToStaticMarkup(<LogLine record={record({ cronJobId: CRON_JOB_ID })} />);
  expect(markup).toContain(CRON_JOB_ID);
  expect(markup).toContain('title="Cron job ID"');
  expect(markup).toContain('cleanup complete');
  expect(markup).toContain('out');
});

test('server log rows carry no cron label', () => {
  const markup = renderToStaticMarkup(<LogLine record={record()} />);
  expect(markup).not.toContain('Cron job ID');
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
    />,
  );
  expect(markup).toContain(CRON_JOB_ID);
  expect(markup).toContain('err');
  expect(markup).toContain('text-destructive');
  expect(markup).toContain('&lt;script&gt;');
  expect(markup).not.toContain('<script>');
});
