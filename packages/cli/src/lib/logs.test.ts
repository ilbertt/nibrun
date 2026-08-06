import { describe, expect, test } from 'bun:test';
import type { TenantLogRecord } from '@repo/protocol';
import { Printed, render } from '#lib/logs.ts';

const DROPPED_BYTES = 4096;

function record(overrides: Partial<TenantLogRecord> = {}): TenantLogRecord {
  return {
    _time: '2026-08-06T09:41:00.123Z',
    _msg: 'listening on 0.0.0.0:8090',
    hostId: 'host-1',
    SOURCE: 'tenant',
    appId: 'app-1',
    deploymentId: 'deployment-1',
    stream: 'stdout',
    sourceId: 'source-1',
    sequence: 0,
    ...overrides,
  } as TenantLogRecord;
}

describe('a page that overlaps the one before it prints only what is new', () => {
  test('a record is printed once', () => {
    const printed = new Printed();

    expect(printed.admit(record())).toBe(true);
    expect(printed.admit(record())).toBe(false);
  });

  test('the next record from the same source is new', () => {
    const printed = new Printed();
    printed.admit(record());

    expect(printed.admit(record({ sequence: 1 }))).toBe(true);
  });

  // Sequence counts within one source, so the same number from another one is another record.
  test('a source that restarted is not the source that stopped', () => {
    const printed = new Printed();
    printed.admit(record());

    expect(printed.admit(record({ sourceId: 'source-2' }))).toBe(true);
  });
});

describe('a record is one line of what the app wrote', () => {
  test('the line carries the time of day, the stream and the message', () => {
    const line = render(record());

    expect(line).toContain('09:41:00.123');
    expect(line).toContain('out');
    expect(line).toContain('listening on 0.0.0.0:8090');
  });

  test('what the app wrote to its error stream is labelled as such', () => {
    expect(render(record({ stream: 'stderr' }))).toContain('err');
  });

  // A gap stands for output the host had to drop, and how much is the whole of what it says.
  test('a gap says how much went missing', () => {
    const line = render(record({ stream: 'stderr', droppedBytes: DROPPED_BYTES }));

    expect(line).toContain(String(DROPPED_BYTES));
  });
});
