import { describe, expect, test } from 'bun:test';
import {
  ExportIdSchema,
  type HostDesiredState,
  HostDesiredStateSchema,
  HostIdSchema,
  Value,
} from '@repo/protocol';
import { NotFoundError } from '#lib/errors.ts';
import type { LogExportInput } from '#repositories/log-exports.repository.ts';
import { ExportLogsService } from '#services/export-logs.service.ts';
import { APP_ID } from '#tests/services/support/fixtures.ts';

const HOST_ID = Value.Parse(HostIdSchema, 'host-1');
const EXPORT_ID = Value.Parse(ExportIdSchema, 'export-1');
const DESIRED = Value.Parse(HostDesiredStateSchema, {
  hostId: HOST_ID,
  instances: [],
  volumes: [],
  checkpoints: [],
  exports: [
    {
      exportId: EXPORT_ID,
      appId: 'app-1',
      volumeId: 'vol-1',
      objectKey: 'export-1.tar.gz',
      artifact: {
        digest: new Bun.CryptoHasher('sha256').update('server').digest('hex'),
        sizeBytes: 1,
        filename: 'server',
        objectKey: 'artifact',
      },
      desiredState: 'present',
      includeLogs: true,
    },
  ],
});

async function* noRecords() {}

function service(
  desired: Readonly<Omit<HostDesiredState, 'exports'>> & {
    exports: readonly HostDesiredState['exports'][number][];
  } = DESIRED,
) {
  const reads: LogExportInput[] = [];
  const hosts: (typeof HOST_ID)[] = [];
  return {
    reads,
    hosts,
    service: new ExportLogsService({
      agentRepo: {
        desiredState({ hostId }) {
          hosts.push(hostId);
          return Promise.resolve({ ...desired, exports: [...desired.exports] });
        },
      },
      logsRepo: {
        open(input) {
          reads.push(input);
          return Promise.resolve(noRecords());
        },
      },
    }),
  };
}

describe('logs are read only for a bundle the host was asked to export', () => {
  test('derives the app from desired state rather than accepting a caller-supplied app ID', async () => {
    const subject = service();
    const signal = new AbortController().signal;
    const before = Date.now();
    await subject.service.open({ hostId: HOST_ID, exportId: EXPORT_ID, signal });
    expect(subject.hosts).toEqual([HOST_ID]);
    expect(subject.reads[0]?.appId).toBe(APP_ID);
    expect(subject.reads[0]?.signal).toBe(signal);
    expect(Date.parse(subject.reads[0]!.through)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(subject.reads[0]!.through)).toBeLessThanOrEqual(Date.now());
  });

  test.each([
    { ...DESIRED, exports: [] },
    {
      ...DESIRED,
      exports: DESIRED.exports.map((bundle) => ({ ...bundle, desiredState: 'absent' as const })),
    },
  ])(
    'rejects an export no longer assigned to the host before reading any logs',
    async (desired) => {
      const subject = service(desired);
      await expect(
        subject.service.open({
          hostId: HOST_ID,
          exportId: EXPORT_ID,
          signal: new AbortController().signal,
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(subject.reads).toEqual([]);
    },
  );
});
