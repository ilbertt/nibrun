import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_HTTP_PORT,
  DEFAULT_INSTANCE_RESOURCES,
  type HostPort,
  HostPortSchema,
  HostReportedStateSchema,
  type HttpPort,
  isValidMessage,
  Value,
} from '@repo/protocol';
import { buildReportedState, toReportedInstance } from '#lib/report/build-report.ts';
import { allocatableCapacity } from '#lib/report/capacity.ts';
import {
  APP_ID,
  EXPORT_ID,
  FIRST_HOST_PORT,
  HOST_ID,
  instanceRecord,
  OBSERVED_AT,
  VOLUME_ID,
  VOLUME_SIZE_BYTES,
} from '#tests/support/fixtures.ts';

const BUNDLE_SIZE_BYTES = 1_782_579;
const HOST_VCPUS = 4;
const HOST_MEMORY_MIB = 8_192;
const HOST_CACHE_BYTES = 1_000;
const FREE_CACHE_BYTES = 400;

const HOST_CAPACITY = {
  vcpuCount: HOST_VCPUS,
  memoryMib: HOST_MEMORY_MIB,
  cacheBytes: HOST_CACHE_BYTES,
};
const BOOTED = [DEFAULT_INSTANCE_RESOURCES, DEFAULT_INSTANCE_RESOURCES];
const DEFAULT_INSTANCE_RESOURCES_AS_CAPACITY = {
  ...DEFAULT_INSTANCE_RESOURCES,
  cacheBytes: HOST_CACHE_BYTES,
};

describe('the report always names the host-side port', () => {
  test('routing is local, but the control plane cannot debug a host without it', () => {
    expect(toReportedInstance(instanceRecord()).hostPort).toBe(FIRST_HOST_PORT);
  });

  test('absent means unknown: no field is ever sent null', () => {
    const reported = toReportedInstance(instanceRecord());
    expect('startedAt' in reported).toBe(false);
    expect('lastHealthyAt' in reported).toBe(false);
    expect('lastExitCode' in reported).toBe(false);
    expect('message' in reported).toBe(false);
  });

  test('an exit code of zero is reported rather than dropped as falsy', () => {
    expect(toReportedInstance(instanceRecord({ lastExitCode: 0 })).lastExitCode).toBe(0);
  });
});

describe('the assembled report satisfies the protocol', () => {
  test('a full report validates against the schema it will be sent as', () => {
    const report = buildReportedState({
      hostId: HOST_ID,
      reportedAt: OBSERVED_AT,
      state: 'ready',
      capacity: HOST_CAPACITY,
      allocatable: {
        vcpuCount: HOST_VCPUS,
        memoryMib: HOST_MEMORY_MIB,
        cacheBytes: FREE_CACHE_BYTES,
      },
      versions: { agent: 'sha', guestImage: '6.1', zerofs: '2.2.1', firecracker: '1.16.1' },
      records: [instanceRecord({ startedAt: OBSERVED_AT })],
      volumes: [
        { volumeId: VOLUME_ID, appId: APP_ID, state: 'ready', sizeBytes: VOLUME_SIZE_BYTES },
      ],
      volumeUsage: new Map(),
      checkpoints: [],
      exports: [
        {
          exportId: EXPORT_ID,
          state: 'ready',
          sizeBytes: BUNDLE_SIZE_BYTES,
          readyAt: OBSERVED_AT,
        },
      ],
    });
    expect(isValidMessage({ schema: HostReportedStateSchema, value: report })).toBe(true);
  });
});

describe('allocatable capacity', () => {
  test('what is booted is subtracted from what the host has', () => {
    expect(
      allocatableCapacity({
        capacity: HOST_CAPACITY,
        committed: BOOTED,
        availableCacheBytes: FREE_CACHE_BYTES,
      }),
    ).toEqual({
      vcpuCount: HOST_VCPUS - DEFAULT_INSTANCE_RESOURCES.vcpuCount * BOOTED.length,
      memoryMib: HOST_MEMORY_MIB - DEFAULT_INSTANCE_RESOURCES.memoryMib * BOOTED.length,
      cacheBytes: FREE_CACHE_BYTES,
    });
  });

  test('an oversubscribed host reports zero rather than a negative', () => {
    expect(
      allocatableCapacity({
        capacity: DEFAULT_INSTANCE_RESOURCES_AS_CAPACITY,
        committed: [HOST_CAPACITY],
        availableCacheBytes: FREE_CACHE_BYTES,
      }),
    ).toEqual({ vcpuCount: 0, memoryMib: 0, cacheBytes: FREE_CACHE_BYTES });
  });

  test('HTTP ports are branded apart from host ports at the type level', () => {
    const httpPort: HttpPort = DEFAULT_HTTP_PORT;
    // @ts-expect-error an HttpPort is not a HostPort, which is what stops a routing bug type-checking
    const hostPort: HostPort = httpPort;
    expect(hostPort).toBe(Value.Parse(HostPortSchema, httpPort as unknown));
  });
});
