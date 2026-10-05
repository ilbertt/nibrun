import { describe, expect, test } from 'bun:test';
import { TimestampSchema, Value } from '@repo/protocol';
import { SeenTenantLogs, type TenantLogRecord } from '#domain/log.ts';

const AN_INSTANT = Value.Parse(TimestampSchema, '2026-08-07T09:51:56.687Z');
const A_LATER_INSTANT = Value.Parse(TimestampSchema, '2026-08-07T09:51:56.756Z');
function logRecord(overrides: Partial<TenantLogRecord> = {}): TenantLogRecord {
  return {
    _time: AN_INSTANT,
    _msg: 'Server started at http://0.0.0.0:8090',
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

describe('a record read twice is handed over once', () => {
  test('the same record is not admitted a second time', () => {
    const seen = new SeenTenantLogs();

    expect(seen.admit(logRecord())).toBe(true);
    expect(seen.admit(logRecord())).toBe(false);
  });

  /**
   * The whole reason this is not a high-water mark. A program announcing itself writes several
   * lines in one millisecond, and the store hands that instant back in an order of its own — so
   * seeing the newest of them first must not condemn the rest as repeats.
   */
  test('the rest of an instant survives having seen its newest record first', () => {
    const seen = new SeenTenantLogs();
    seen.admit(logRecord({ sequence: 2 }));

    expect(seen.admit(logRecord({ sequence: 1 }))).toBe(true);
    expect(seen.admit(logRecord({ sequence: 0 }))).toBe(true);
  });

  test('the next record from the same source is new', () => {
    const seen = new SeenTenantLogs();
    seen.admit(logRecord());

    expect(seen.admit(logRecord({ sequence: 1 }))).toBe(true);
  });

  // Sequence counts within one source, so the same number from another one is another record.
  test('a source that restarted is not the source that stopped', () => {
    const seen = new SeenTenantLogs();
    seen.admit(logRecord());

    expect(seen.admit(logRecord({ sourceId: 'source-2' }))).toBe(true);
  });

  // What a reconnect asks for: the seconds it was away, which carry what it did not miss.
  test('an instant already passed is a repeat however it is numbered', () => {
    const seen = new SeenTenantLogs();
    seen.admit(logRecord({ _time: A_LATER_INSTANT, sequence: 5 }));

    expect(seen.admit(logRecord({ _time: AN_INSTANT, sequence: 0 }))).toBe(false);
  });

  // Only the newest instant's keys are kept, so following an app for a day costs one instant.
  test('moving on forgets the instant left behind', () => {
    const seen = new SeenTenantLogs();
    seen.admit(logRecord());
    seen.admit(logRecord({ _time: A_LATER_INSTANT, sequence: 1 }));

    expect(seen.admit(logRecord({ _time: A_LATER_INSTANT, sequence: 1 }))).toBe(false);
  });
});
