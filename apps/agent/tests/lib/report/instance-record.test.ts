import { describe, expect, test } from 'bun:test';
import { HttpPortSchema, Value } from '@repo/protocol';
import { readInstanceRecords } from '#lib/report/instance-record.ts';

const RENAMED_FROM_PORT = 3000;
const WRITTEN_UNDER_NEW_NAME_PORT = 8080;
const HOST_PORT_NUMBER = 20_001;
const DIGEST_LENGTH = 64;

function note(port: Record<string, number>) {
  return {
    appId: 'app-1',
    deploymentId: 'dep-1',
    volumeId: 'vol-1',
    hostnames: ['demo.nibrun.app'],
    hostPort: HOST_PORT_NUMBER,
    guestIpv4: '10.201.0.2',
    artifactDigest: 'a'.repeat(DIGEST_LENGTH),
    state: 'running',
    health: { consecutiveFailures: 0 },
    restartCount: 0,
    ...port,
  };
}

describe('an agent reads the notes the last one left', () => {
  test('a note naming the port it was renamed from is kept, under the new name', () => {
    const [record] = readInstanceRecords([note({ guestPort: RENAMED_FROM_PORT })]);

    expect(record?.httpPort).toBe(Value.Parse(HttpPortSchema, RENAMED_FROM_PORT));
    expect(record).not.toHaveProperty('guestPort');
  });

  test('a note this agent wrote itself is left alone', () => {
    const [record] = readInstanceRecords([note({ httpPort: WRITTEN_UNDER_NEW_NAME_PORT })]);

    expect(record?.httpPort).toBe(Value.Parse(HttpPortSchema, WRITTEN_UNDER_NEW_NAME_PORT));
  });

  // Dropping one is what replaces the still-running unit it describes, so the guard stays the
  // thing that decides: the rename above must not become a way in for anything else.
  test('a note missing the port under either name is still discarded', () => {
    expect(readInstanceRecords([note({})])).toEqual([]);
  });
});
