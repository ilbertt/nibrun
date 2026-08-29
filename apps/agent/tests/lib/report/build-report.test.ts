import { describe, expect, test } from 'bun:test';
import {
  type AppId,
  AppIdSchema,
  type ComputeUsage,
  DEFAULT_HTTP_PORT,
  DEFAULT_INSTANCE_RESOURCES,
  type FilesystemUsage,
  type HostPort,
  HostPortSchema,
  HostReportedStateSchema,
  type HttpPort,
  Ipv4AddressSchema,
  isValidMessage,
  Value,
} from '@repo/protocol';
import { buildReportedState, toReportedInstance } from '#lib/report/build-report.ts';
import { allocatableCapacity } from '#lib/report/capacity.ts';
import type { InstanceRecord } from '#lib/report/instance-record.ts';
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

const RELAY_IPV4 = Value.Parse(Ipv4AddressSchema, '203.0.113.7');
const FIRST_EXTRA_PUBLIC_PORT = 22_000;
const EXTRA_PUBLIC_PORT = Value.Parse(HostPortSchema, FIRST_EXTRA_PUBLIC_PORT);

/** The common case: an app that asked for no public port of its own, which is most of them. */
function reported(overrides: Partial<InstanceRecord> = {}) {
  return toReportedInstance({
    record: instanceRecord(overrides),
    reachedAt: undefined,
    measured: undefined,
  });
}

describe('the report always names the host-side port', () => {
  test('routing is local, but the control plane cannot debug a host without it', () => {
    expect(reported().hostPort).toBe(FIRST_HOST_PORT);
  });

  test('absent means unknown: no field is ever sent null', () => {
    const instance = reported();
    expect('startedAt' in instance).toBe(false);
    expect('lastHealthyAt' in instance).toBe(false);
    expect('lastExitCode' in instance).toBe(false);
    expect('message' in instance).toBe(false);
    // The pair an app that asked for no public port is not given, held to the same rule.
    expect('publicIpv4' in instance).toBe(false);
    expect('extraPublicPort' in instance).toBe(false);
  });

  // The control plane holds neither half — the address is the relay's and the port is the slot's —
  // so a report that omits them is an app nothing can be told where to reach.
  test('an app that asked for its own port is reported with where it answers', () => {
    const reported = toReportedInstance({
      record: instanceRecord({ hasExtraPublicPort: true }),
      reachedAt: { ipv4: RELAY_IPV4, port: EXTRA_PUBLIC_PORT },
      measured: undefined,
    });

    expect(reported.publicIpv4).toBe(RELAY_IPV4);
    expect(reported.extraPublicPort).toBe(EXTRA_PUBLIC_PORT);
  });

  test('an exit code of zero is reported rather than dropped as falsy', () => {
    expect(reported({ lastExitCode: 0 }).lastExitCode).toBe(0);
  });
});

/**
 * The one place a reading meets the volume it is about. Measuring happens on a loop of its own,
 * so what is asserted here is only that the two are matched on the app they name.
 */
describe('a volume carries the reading last taken of it', () => {
  const MEASURED: FilesystemUsage = {
    totalBytes: 8_455_712_768,
    usedBytes: 1_503_238_553,
    measuredAt: OBSERVED_AT,
  };

  function reportOf(volumeUsage: ReadonlyMap<AppId, FilesystemUsage>) {
    return buildReportedState({
      hostId: HOST_ID,
      reportedAt: OBSERVED_AT,
      state: 'ready',
      capacity: HOST_CAPACITY,
      allocatable: HOST_CAPACITY,
      versions: { agent: 'sha', guestImage: '6.1', zerofs: '2.2.1', firecracker: '1.16.1' },
      records: [],
      reachedAt: new Map(),
      computeUsage: new Map(),
      volumes: [
        { volumeId: VOLUME_ID, appId: APP_ID, state: 'ready', sizeBytes: VOLUME_SIZE_BYTES },
      ],
      volumeUsage,
      checkpoints: [],
      exports: [],
    });
  }

  test('the reading is matched to the volume by the app both name', () => {
    const [volume] = reportOf(new Map([[APP_ID, MEASURED]])).volumes;

    expect(volume?.usage).toEqual(MEASURED);
  });

  // Absent rather than zero: a volume nothing has measured has a size and no reading, and a zero
  // would be a filesystem somebody had just emptied.
  test('a volume nothing has measured carries no reading at all', () => {
    const [volume] = reportOf(new Map()).volumes;

    expect(volume && 'usage' in volume).toBe(false);
  });

  // Keyed on the app rather than on the volume, which is the mistake the two ids invite.
  test('a reading about another app is not put on this one', () => {
    const other = Value.Parse(AppIdSchema, 'app-somebody-else');
    const [volume] = reportOf(new Map([[other, MEASURED]])).volumes;

    expect(volume && 'usage' in volume).toBe(false);
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
      records: [instanceRecord({ startedAt: OBSERVED_AT, hasExtraPublicPort: true })],
      reachedAt: new Map([[APP_ID, { ipv4: RELAY_IPV4, port: EXTRA_PUBLIC_PORT }]]),
      volumes: [
        { volumeId: VOLUME_ID, appId: APP_ID, state: 'ready', sizeBytes: VOLUME_SIZE_BYTES },
      ],
      volumeUsage: new Map(),
      computeUsage: new Map(),
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

/**
 * The compute half of the same arrangement, matched on the app rather than on the record: what a
 * guest is spending is asked for on a loop of its own, and an instance is observed by looking at
 * a systemd unit that knows nothing about it.
 */
describe('an instance carries the reading last taken of its guest', () => {
  const SPENDING: ComputeUsage = {
    memoryTotalBytes: 1_031_012_352,
    memoryUsedBytes: 412_401_664,
    cpuShare: 0.18,
    measuredAt: OBSERVED_AT,
  };

  test('a measured guest reports what it is spending', () => {
    expect(
      toReportedInstance({
        record: instanceRecord(),
        reachedAt: undefined,
        measured: SPENDING,
      }).compute,
    ).toEqual(SPENDING);
  });

  // An instance that has never been measured is one nothing has asked yet, which is every
  // instance for the first minute it is up — and absent is this protocol's one word for unknown.
  test('an unmeasured guest carries no field at all', () => {
    expect(
      'compute' in
        toReportedInstance({ record: instanceRecord(), reachedAt: undefined, measured: undefined }),
    ).toBe(false);
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
