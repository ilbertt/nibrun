import { describe, expect, test } from 'bun:test';
import type { Print } from '@parshjs/core';
import type { TenantLogRecord } from '@repo/protocol';
import { Printed, render, show } from '#lib/logs.ts';

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

/** Which level a record went out at is the whole of what `show` decides. */
function printer(): Print & { at: string[] } {
  const at: string[] = [];
  return {
    at,
    info: () => at.push('info'),
    success: () => at.push('success'),
    warn: () => at.push('warn'),
    error: () => at.push('error'),
    dim: () => at.push('dim'),
  };
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
    expect(render(record())).toBe('09:41:00.123 out listening on 0.0.0.0:8090');
  });

  test('what the app wrote to its error stream is labelled as such', () => {
    expect(render(record({ stream: 'stderr' }))).toStartWith('09:41:00.123 err');
  });

  // A gap stands for output the host had to drop, and how much is the whole of what it says.
  test('a gap says how much went missing', () => {
    const line = render(record({ stream: 'stderr', droppedBytes: DROPPED_BYTES }));

    expect(line).toEndWith(`(${DROPPED_BYTES} bytes)`);
  });
});

describe('the stream a record came out of is the stream it goes back into', () => {
  test('ordinary output is written plainly to ours', () => {
    const print = printer();

    show({ record: record(), print });

    expect(print.at).toEqual(['info']);
  });

  test('what the app wrote to its error stream goes to ours', () => {
    const print = printer();

    show({ record: record({ stream: 'stderr' }), print });

    expect(print.at).toEqual(['error']);
  });

  // A gap is the host speaking, not the app, so it is not dressed as the app's own error output.
  test('a gap is a warning rather than the app error output', () => {
    const print = printer();

    show({ record: record({ stream: 'stderr', droppedBytes: DROPPED_BYTES }), print });

    expect(print.at).toEqual(['warn']);
  });
});
