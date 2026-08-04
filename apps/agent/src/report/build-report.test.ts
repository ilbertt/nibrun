import { describe, expect, test } from 'bun:test';
import {
  type AppId,
  DEFAULT_GUEST_PORT,
  DEFAULT_HEALTH_CHECK,
  DEFAULT_INSTANCE_RESOURCES,
  type DeploymentId,
  type ExportId,
  type GuestPort,
  type HostId,
  type Hostname,
  type HostPort,
  HostReportedStateSchema,
  type InstanceId,
  type InstanceState,
  type Ipv4Address,
  isValidMessage,
  type Sha256Digest,
  type Timestamp,
  type VolumeId,
} from '@repo/protocol';
import { initialTracker } from '#health/state.ts';
import { buildReportedState, toReportedInstance } from '#report/build-report.ts';
import { allocatableCapacity } from '#report/capacity.ts';
import type { InstanceRecord } from '#report/instance-record.ts';
import { renderableRoutes } from '#report/routes.ts';

const AT = '2026-08-03T10:00:00.000Z' as Timestamp;
const DIGEST_HEX_LENGTH = 64;
const FIRST_HOST_PORT = 21_000 as HostPort;
const OBSERVED_GENERATION = 7;
const BUNDLE_SIZE_BYTES = 1_782_579;
const HOST_VCPUS = 4;
const HOST_MEMORY_MIB = 8_192;
const HOST_CACHE_BYTES = 1_000;
const FREE_CACHE_BYTES = 400;
const VOLUME_SIZE_BYTES = 4_096;

const record = (overrides: Partial<InstanceRecord> = {}): InstanceRecord => ({
  instanceId: 'inst-1' as InstanceId,
  appId: 'app-1' as AppId,
  deploymentId: 'dep-1' as DeploymentId,
  volumeId: 'vol-1' as VolumeId,
  hostnames: [{ hostname: 'a.example.com' as Hostname, kind: 'platform', isDefault: true }],
  hostPort: FIRST_HOST_PORT,
  guestPort: DEFAULT_GUEST_PORT,
  guestIpv4: '10.201.0.2' as Ipv4Address,
  artifactDigest: 'a'.repeat(DIGEST_HEX_LENGTH) as Sha256Digest,
  state: 'running' as InstanceState,
  health: initialTracker(),
  healthCheck: DEFAULT_HEALTH_CHECK,
  resources: DEFAULT_INSTANCE_RESOURCES,
  desiredRunning: true,
  startAttempts: { attempts: 1 },
  restartCount: 0,
  stopRequested: false,
  ...overrides,
});

describe('the report always names the host-side port', () => {
  test('routing is local, but the control plane cannot debug a host without it', () => {
    expect(toReportedInstance(record()).hostPort).toBe(FIRST_HOST_PORT);
  });

  test('absent means unknown: no field is ever sent null', () => {
    const reported = toReportedInstance(record());
    expect('startedAt' in reported).toBe(false);
    expect('lastHealthyAt' in reported).toBe(false);
    expect('lastExitCode' in reported).toBe(false);
    expect('message' in reported).toBe(false);
  });

  test('an exit code of zero is reported rather than dropped as falsy', () => {
    expect(toReportedInstance(record({ lastExitCode: 0 })).lastExitCode).toBe(0);
  });
});

describe('the assembled report satisfies the protocol', () => {
  test('a full report validates against the schema it will be sent as', () => {
    const report = buildReportedState({
      hostId: 'host-1' as HostId,
      observedGeneration: OBSERVED_GENERATION,
      reportedAt: AT,
      state: 'ready',
      capacity: { vcpuCount: HOST_VCPUS, memoryMib: HOST_MEMORY_MIB, cacheBytes: HOST_CACHE_BYTES },
      allocatable: {
        vcpuCount: HOST_VCPUS,
        memoryMib: HOST_MEMORY_MIB,
        cacheBytes: FREE_CACHE_BYTES,
      },
      versions: { agent: 'sha', guestImage: '6.1', zerofs: '2.2.1', firecracker: '1.16.1' },
      records: [record({ startedAt: AT })],
      volumes: [{ volumeId: 'vol-1' as VolumeId, state: 'ready', sizeBytes: VOLUME_SIZE_BYTES }],
      checkpoints: [],
      exports: [
        {
          exportId: 'exp-1' as ExportId,
          state: 'ready',
          sizeBytes: BUNDLE_SIZE_BYTES,
          readyAt: AT,
        },
      ],
    });
    expect(isValidMessage({ schema: HostReportedStateSchema, value: report })).toBe(true);
  });
});

describe('the same records render the routing layer', () => {
  test('only instances whose tenant answered are routable', () => {
    const records = [
      record(),
      record({ instanceId: 'inst-2' as InstanceId, state: 'starting' }),
      record({ instanceId: 'inst-3' as InstanceId, state: 'unhealthy' }),
    ];
    expect(renderableRoutes(records)).toEqual([
      {
        appId: 'app-1' as AppId,
        hostnames: records[0]?.hostnames ?? [],
        hostPort: FIRST_HOST_PORT,
      },
    ]);
  });

  test('an app with no hostname yet is not routed', () => {
    expect(renderableRoutes([record({ hostnames: [] })])).toEqual([]);
  });
});

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

  test('guest ports are branded apart from host ports at the type level', () => {
    const guestPort: GuestPort = DEFAULT_GUEST_PORT;
    // @ts-expect-error a GuestPort is not a HostPort, which is what stops a routing bug type-checking
    const hostPort: HostPort = guestPort;
    expect(hostPort).toBe(guestPort as unknown as HostPort);
  });
});
